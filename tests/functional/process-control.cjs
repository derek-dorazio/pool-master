/**
 * The functional harness's one way of stopping a server process (#272). Setup uses it to stop a
 * server it spawned that never became reachable; teardown uses it to stop the shared daemon once
 * no run is left. One sequence, so the two cannot drift apart.
 */

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return !(error && error.code === 'ESRCH');
  }
}

/** SIGTERM, up to 5 s for a graceful exit, then SIGKILL. Resolves once the process is gone or killed. */
async function terminatePid(pid) {
  try {
    process.kill(pid, 'SIGTERM');
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      throw error;
    }
    return;
  }

  for (let i = 0; i < 20; i += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error && error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    await sleep(250);
  }

  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (error && error.code !== 'ESRCH') {
      throw error;
    }
  }
}

module.exports = { isPidAlive, sleep, terminatePid };
