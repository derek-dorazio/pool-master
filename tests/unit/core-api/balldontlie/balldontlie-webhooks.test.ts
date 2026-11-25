import { Sport } from '@poolmaster/shared/domain';
import { BalldontlieWebhookNotificationSchema } from '@poolmaster/shared/dto';
import {
  balldontlieQuietAfterMs,
  checkBalldontlieSignature,
  readBalldontlieNotification,
} from '../../../../packages/core-api/src/modules/ingestion/adapters/balldontlie/balldontlie-webhooks';
import {
  BALLDONTLIE_WEBHOOK_PAYLOADS as PAYLOADS,
  TEST_BALLDONTLIE_WEBHOOK_SECRET as SECRET,
  balldontlieSignature,
} from '../../../support/balldontlie-webhooks';
import { BALLDONTLIE_TEST_LEAGUES as LEAGUES } from '../../../support/balldontlie-provider-rows';

const read = (body: object) => readBalldontlieNotification(BalldontlieWebhookNotificationSchema.parse(body), LEAGUES);

describe('reading BALLDONTLIE webhook notifications (#1498)', () => {
  it('reads a subscribed NFL game event as that game\'s notification, for the NFL\'s scopes', () => {
    expect(read(PAYLOADS.nflGameEnded)).toEqual({
      providerId: 'balldontlie',
      sport: Sport.FOOTBALL,
      notificationType: 'nfl.game.ended',
      phase: 'END',
      subject: 'GAME',
      gameId: '424095',
      providerLeagueCode: 'nfl',
    });
    expect(read(PAYLOADS.nflGameStarted)).toMatchObject({ subject: 'GAME', gameId: '424095' });
    expect(read(PAYLOADS.nflGamePeriodEnded)).toMatchObject({ subject: 'GAME', gameId: '424095' });
  });

  it('reads a college football game event as a notification for the College Football Playoff\'s scope, not the NFL\'s', () => {
    expect(read(PAYLOADS.ncaafGameEnded)).toMatchObject({ sport: Sport.FOOTBALL, providerLeagueCode: 'ncaaf', gameId: '5041', phase: 'END' });
  });

  it('reads the NBA\'s, each NCAA tournament\'s, the Premier League\'s and the World Cup\'s game events with their own league\'s event prefix', () => {
    expect(read(PAYLOADS.nbaGameEnded)).toMatchObject({ sport: Sport.BASKETBALL, providerLeagueCode: 'nba', gameId: '21707974', phase: 'END' });
    expect(read(PAYLOADS.ncaabGameEnded)).toMatchObject({ sport: Sport.BASKETBALL, providerLeagueCode: 'ncaab', gameId: '2798627' });
    expect(read(PAYLOADS.ncaawGameEnded)).toMatchObject({ sport: Sport.BASKETBALL, providerLeagueCode: 'ncaaw', gameId: '6100' });
    expect(read(PAYLOADS.eplGameHalftime)).toMatchObject({ sport: Sport.SOCCER, providerLeagueCode: 'epl', gameId: '1922' });
    expect(read(PAYLOADS.worldCupGameEnded)).toMatchObject({ sport: Sport.SOCCER, providerLeagueCode: 'worldcup', gameId: '999' });
  });

  it('reads golf\'s tournament and round events as the tournament\'s own event, named by its tournament id', () => {
    for (const payload of [PAYLOADS.pgaTournamentStarted, PAYLOADS.pgaRoundStarted, PAYLOADS.pgaTournamentEnded]) {
      expect(read(payload)).toMatchObject({ sport: Sport.GOLF, subject: 'EVENT', eventId: String(payload.tournament.id) });
    }
    expect(read(PAYLOADS.pgaPlayerRoundCompleted)).toEqual({
      providerId: 'balldontlie',
      sport: Sport.GOLF,
      notificationType: 'pga.player.round_completed',
      phase: 'PROGRESS',
      subject: 'EVENT',
      eventId: '24',
    });
  });

  it('places each notification in play: a game or tournament or round starting, play under way, or a game or tournament ending (#1499)', () => {
    expect(read(PAYLOADS.nflGameStarted)?.phase).toBe('START');
    expect(read(PAYLOADS.nflGamePeriodEnded)?.phase).toBe('PROGRESS');
    expect(read(PAYLOADS.eplGameHalftime)?.phase).toBe('PROGRESS');
    expect(read(PAYLOADS.worldCupGameEnded)?.phase).toBe('END');
    expect(read(PAYLOADS.pgaTournamentStarted)?.phase).toBe('START');
    expect(read(PAYLOADS.pgaRoundStarted)?.phase).toBe('START');
    expect(read(PAYLOADS.pgaPlayerRoundCompleted)?.phase).toBe('PROGRESS');
    expect(read(PAYLOADS.pgaTournamentEnded)?.phase).toBe('END');
  });

  it('acts on no per-play event, no golf hole, no league without a reader, and no event type it cannot split', () => {
    expect(read(PAYLOADS.nflTouchdown)).toBeNull();
    expect(read(PAYLOADS.pgaHoleCompleted)).toBeNull();
    expect(read({ event_type: 'mls.game.ended', game: { id: 1 } })).toBeNull();
    expect(read({ event_type: 'test' })).toBeNull();
    expect(read({ type: 'test', sport: 'test' })).toBeNull();
    expect(read({ event_type: 'toString.game.ended', game: { id: 1 } })).toBeNull();
  });

  it('acts on no subscribed event that is missing the game or tournament it should name', () => {
    expect(read({ event_type: 'nfl.game.ended' })).toBeNull();
    expect(read({ event_type: 'pga.tournament.started' })).toBeNull();
  });
});

describe('how long a BALLDONTLIE event may stay in play with no notification (#1499)', () => {
  const quietMinutes = (providerLeagueCode: string) => balldontlieQuietAfterMs(LEAGUES, providerLeagueCode) / 60_000;

  it('allows each league its longest normal gap between notifications, a period or half plus its break, never as short as one quarter', () => {
    expect(quietMinutes('nfl')).toBe(90);
    expect(quietMinutes('ncaaf')).toBe(110);
    expect(quietMinutes('nba')).toBe(75);
    expect(quietMinutes('ncaab')).toBe(90);
    expect(quietMinutes('ncaaw')).toBe(75);
    expect(quietMinutes('nhl')).toBe(90);
    expect(quietMinutes('mlb')).toBe(210);
    expect(quietMinutes('wnba')).toBe(75);
    expect(quietMinutes('epl')).toBe(90);
    expect(quietMinutes('worldcup')).toBe(150);
  });

  it('allows a golf round six hours, since its first notification after the start is the first group finishing', () => {
    expect(quietMinutes('pga')).toBe(360);
  });

  it('allows an event of a provider league with no row the longest gap of any, so it is never warned about early', () => {
    expect(quietMinutes('mls')).toBe(360);
  });
});

describe('checking a BALLDONTLIE delivery\'s signature (#1498)', () => {
  const now = new Date('2026-11-15T18:00:00.000Z');
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const body = JSON.stringify(PAYLOADS.nflGameEnded);
  const rawBody = Buffer.from(body, 'utf8');
  const signed = { timestamp, signature: balldontlieSignature(timestamp, rawBody), rawBody };

  it('accepts a delivery signed with the endpoint secret over its timestamp and exact body', () => {
    expect(checkBalldontlieSignature(signed, SECRET, now)).toBe('VALID');
  });

  it('accepts a delivery signed up to five minutes either side of now, since each retry is signed afresh', () => {
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() + 300_000))).toBe('VALID');
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() - 300_000))).toBe('VALID');
  });

  it('refuses a replay signed more than five minutes ago, or a timestamp from the future', () => {
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() + 301_000))).toBe('STALE');
    expect(checkBalldontlieSignature(signed, SECRET, new Date(now.getTime() - 301_000))).toBe('STALE');
  });

  it('refuses a body changed after signing, a different secret, and a signature moved to another timestamp', () => {
    expect(checkBalldontlieSignature({ ...signed, rawBody: Buffer.from(body.replace('424095', '424096'), 'utf8') }, SECRET, now)).toBe('MISMATCH');
    expect(checkBalldontlieSignature(signed, 'whsec_other', now)).toBe('MISMATCH');
    expect(checkBalldontlieSignature({ ...signed, timestamp: String(Number(timestamp) - 1) }, SECRET, now)).toBe('MISMATCH');
  });

  it('checks the body\'s exact bytes, so bytes that do not survive decoding to text still verify and a re-encoded body does not', () => {
    // A lone 0xff is not UTF-8: decoding it to text would turn it into U+FFFD and change what was hashed.
    const bytes = Buffer.concat([Buffer.from('{"event_type":"nfl.game.ended","note":"', 'utf8'), Buffer.from([0xff]), Buffer.from('"}', 'utf8')]);
    const delivery = { timestamp, signature: balldontlieSignature(timestamp, bytes), rawBody: bytes };
    expect(checkBalldontlieSignature(delivery, SECRET, now)).toBe('VALID');
    expect(checkBalldontlieSignature({ ...delivery, rawBody: Buffer.from(bytes.toString('utf8'), 'utf8') }, SECRET, now)).toBe('MISMATCH');
  });

  it('accepts a header carrying several v1 signatures, as sent while the secret rotates, when any one of them matches', () => {
    const oldSecret = balldontlieSignature(timestamp, rawBody, 'whsec_retiring');
    expect(checkBalldontlieSignature({ ...signed, signature: `${oldSecret},${signed.signature}` }, SECRET, now)).toBe('VALID');
    expect(checkBalldontlieSignature({ ...signed, signature: `${signed.signature} ${oldSecret}` }, SECRET, now)).toBe('VALID');
    expect(checkBalldontlieSignature({ ...signed, signature: `${oldSecret}, ${signed.signature}` }, SECRET, now)).toBe('VALID');
  });

  it('refuses a header of several v1 signatures when none matches, and ignores tokens of another scheme beside a matching one', () => {
    const other = balldontlieSignature(timestamp, rawBody, 'whsec_other');
    const retiring = balldontlieSignature(timestamp, rawBody, 'whsec_retiring');
    expect(checkBalldontlieSignature({ ...signed, signature: `${other},${retiring}` }, SECRET, now)).toBe('MISMATCH');
    expect(checkBalldontlieSignature({ ...signed, signature: `v0=abc,${signed.signature}` }, SECRET, now)).toBe('VALID');
  });

  it('refuses a delivery without both headers, and one whose headers are not the documented format', () => {
    expect(checkBalldontlieSignature({ ...signed, signature: undefined }, SECRET, now)).toBe('MISSING');
    expect(checkBalldontlieSignature({ ...signed, timestamp: undefined }, SECRET, now)).toBe('MISSING');
    expect(checkBalldontlieSignature({ ...signed, signature: signed.signature.replace('v1=', 'v2=') }, SECRET, now)).toBe('MALFORMED');
    expect(checkBalldontlieSignature({ ...signed, signature: 'v1=abc' }, SECRET, now)).toBe('MALFORMED');
    expect(checkBalldontlieSignature({ ...signed, signature: ' , ' }, SECRET, now)).toBe('MALFORMED');
    expect(checkBalldontlieSignature({ ...signed, timestamp: '2026-11-15T18:00:00Z' }, SECRET, now)).toBe('MALFORMED');
  });
});

describe('BALLDONTLIE webhooks follow its league rows (#1997)', () => {
  const withoutMlb = LEAGUES.filter((league) => league.code !== 'mlb');

  it('drops a notification about a league that has no enabled row', () => {
    const body = BalldontlieWebhookNotificationSchema.parse({ event_type: 'mlb.game.ended', game: { id: 7 } });

    expect(readBalldontlieNotification(body, LEAGUES)).not.toBeNull();
    expect(readBalldontlieNotification(body, withoutMlb)).toBeNull();
  });

  it('takes a league\'s quiet window from its row, so an edit on the Providers page changes it', () => {
    const longer = LEAGUES.map((league) => (league.code === 'nfl' ? { ...league, quietAfterMinutes: 120 } : league));

    expect(balldontlieQuietAfterMs(longer, 'nfl')).toBe(120 * 60_000);
  });
});
