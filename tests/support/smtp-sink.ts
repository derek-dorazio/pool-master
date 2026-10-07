import { createServer, type Server, type Socket } from 'net';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';

/**
 * One message the sink accepted: the SMTP envelope plus the parts of the DATA a test asserts on.
 * `to` is the envelope recipients (RCPT TO), which is who the mail actually goes to.
 */
export interface CapturedMail {
  from: string;
  to: string[];
  subject: string;
  text: string;
  receivedAt: string;
}

export interface SmtpSinkServer {
  server: Server;
  port: number;
  /** Every message accepted since the sink started, oldest first. */
  messages: CapturedMail[];
  close: () => Promise<void>;
}

/**
 * A local SMTP server for the test lanes: it accepts every message and records it in `messages`,
 * so a test can prove which emails the app sent, to whom, and with which links (#442).
 */
export async function startSmtpSinkServer(): Promise<SmtpSinkServer> {
  const messages: CapturedMail[] = [];
  const server = createServer((socket) => handleSmtpSinkConnection(socket, messages));

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('SMTP sink did not bind to a TCP port.');
  }

  return {
    server,
    port: address.port,
    messages,
    close: () => closeServer(server),
  };
}

export interface MailInboxServer {
  url: string;
  close: () => Promise<void>;
}

/**
 * Serves a sink's captured messages over HTTP (`GET /messages`) for tests that run in another
 * process than the sink, as the functional lane's jest workers do against its server daemon.
 */
export async function startMailInboxServer(sink: SmtpSinkServer): Promise<MailInboxServer> {
  const server = createHttpServer((request, response) => {
    if (request.method === 'GET' && request.url === '/messages') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(sink.messages));
      return;
    }
    response.writeHead(404).end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeServer(server);
    throw new Error('Mail inbox did not bind to a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

async function closeServer(server: Server | HttpServer): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function handleSmtpSinkConnection(socket: Socket, messages: CapturedMail[]): void {
  socket.setEncoding('utf8');
  socket.write('220 poolmaster-test-smtp ESMTP\r\n');

  let buffer = '';
  let readingData = false;
  let envelopeFrom = '';
  let envelopeTo: string[] = [];
  let dataLines: string[] = [];

  const resetEnvelope = (): void => {
    envelopeFrom = '';
    envelopeTo = [];
    dataLines = [];
  };

  socket.on('data', (chunk) => {
    buffer += chunk.toString();

    for (;;) {
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        break;
      }

      const rawLine = buffer.slice(0, newlineIndex + 1);
      buffer = buffer.slice(newlineIndex + 1);
      const line = rawLine.replace(/\r?\n$/, '');

      if (readingData) {
        if (line === '.') {
          readingData = false;
          // Recorded before the 250 reply, so the message is visible by the time the sender's
          // send (and the API request that awaited it) has returned.
          messages.push({
            from: envelopeFrom,
            to: envelopeTo,
            ...parseMessage(dataLines.join('\r\n')),
            receivedAt: new Date().toISOString(),
          });
          resetEnvelope();
          socket.write('250 2.0.0 OK: queued\r\n');
        } else {
          // SMTP dot-stuffing: a leading '.' in the content is sent doubled.
          dataLines.push(line.startsWith('.') ? line.slice(1) : line);
        }
        continue;
      }

      const verb = line.split(/\s+/, 1)[0]?.toUpperCase();
      switch (verb) {
        case 'EHLO':
        case 'HELO':
          socket.write('250-poolmaster-test-smtp\r\n250-PIPELINING\r\n250-8BITMIME\r\n250 SMTPUTF8\r\n');
          break;
        case 'MAIL':
          resetEnvelope();
          envelopeFrom = extractAddress(line);
          socket.write('250 2.0.0 OK\r\n');
          break;
        case 'RCPT':
          envelopeTo.push(extractAddress(line));
          socket.write('250 2.0.0 OK\r\n');
          break;
        case 'RSET':
          resetEnvelope();
          socket.write('250 2.0.0 OK\r\n');
          break;
        case 'NOOP':
          socket.write('250 2.0.0 OK\r\n');
          break;
        case 'DATA':
          readingData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
          break;
        case 'QUIT':
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
          break;
        default:
          socket.write('250 2.0.0 OK\r\n');
          break;
      }
    }
  });
}

function extractAddress(commandLine: string): string {
  const match = /<([^>]*)>/.exec(commandLine);
  return (match?.[1] ?? '').trim();
}

/** The subject and plain-text body of a raw RFC 5322 message, MIME-decoded. */
function parseMessage(raw: string): { subject: string; text: string } {
  const { headers, body } = splitHeaders(raw);
  return {
    subject: decodeEncodedWords(headers.get('subject') ?? ''),
    text: findPlainText(headers, body) ?? '',
  };
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const separator = /\r?\n\r?\n/.exec(raw);
  const headerBlock = separator ? raw.slice(0, separator.index) : raw;
  const body = separator ? raw.slice(separator.index + separator[0].length) : '';
  const headers = new Map<string, string>();
  // Unfold continuation lines (those starting with whitespace) before splitting on names.
  for (const line of headerBlock.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
  }
  return { headers, body };
}

function findPlainText(headers: Map<string, string>, body: string): string | null {
  const contentType = headers.get('content-type') ?? 'text/plain';
  const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
  if (/^multipart\//i.test(contentType) && boundary) {
    const parts = body.split(`--${boundary}`).slice(1);
    for (const part of parts) {
      if (part.startsWith('--')) break;
      const parsed = splitHeaders(part.replace(/^\r?\n/, ''));
      const text = findPlainText(parsed.headers, parsed.body);
      if (text !== null) return text;
    }
    return null;
  }
  if (!/^text\/plain/i.test(contentType)) {
    return null;
  }
  return decodeTransferEncoding(body.replace(/\r?\n$/, ''), headers.get('content-transfer-encoding'));
}

function decodeTransferEncoding(body: string, encoding: string | undefined): string {
  switch (encoding?.toLowerCase()) {
    case 'quoted-printable':
      return Buffer.from(
        body
          .replace(/=\r?\n/g, '')
          .replace(/=([0-9A-F]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
        'latin1',
      ).toString('utf8');
    case 'base64':
      return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
    default:
      return body;
  }
}

/** RFC 2047 `=?charset?B|Q?...?=` words, as a sender uses for a non-ASCII subject. */
function decodeEncodedWords(value: string): string {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?[^?]+\?([BQ])\?([^?]*)\?=/gi, (_match, kind: string, data: string) => (
      kind.toUpperCase() === 'B'
        ? Buffer.from(data, 'base64').toString('utf8')
        : Buffer.from(
            data
              .replace(/_/g, ' ')
              .replace(/=([0-9A-F]{2})/gi, (_hex, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))),
            'latin1',
          ).toString('utf8')
    ));
}
