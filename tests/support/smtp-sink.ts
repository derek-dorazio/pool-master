import { createServer, type Server, type Socket } from 'net';

export interface SmtpSinkServer {
  server: Server;
  port: number;
  close: () => Promise<void>;
}

export async function startSmtpSinkServer(): Promise<SmtpSinkServer> {
  const server = createServer(handleSmtpSinkConnection);

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    await closeSmtpSinkServer(server);
    throw new Error('SMTP sink did not bind to a TCP port.');
  }

  return {
    server,
    port: address.port,
    close: () => closeSmtpSinkServer(server),
  };
}

async function closeSmtpSinkServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function handleSmtpSinkConnection(socket: Socket): void {
  socket.setEncoding('utf8');
  socket.write('220 poolmaster-test-smtp ESMTP\r\n');

  let buffer = '';
  let readingData = false;

  socket.on('data', (chunk) => {
    buffer += chunk;

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
          socket.write('250 2.0.0 OK: queued\r\n');
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
        case 'RCPT':
        case 'RSET':
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
