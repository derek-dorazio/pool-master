/**
 * Imported first by a suite that compares leaderboards computed two ways: the contest services it
 * builds then keep no board (#1162's cache, TTL 0), so each read computes its board afresh.
 */
process.env['CONTEST_LEADERBOARD_CACHE_TTL_MS'] = '0';
