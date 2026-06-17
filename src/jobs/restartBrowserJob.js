import cron from 'node-cron';
import { restartBrowser } from '../utils/pdfGenerator.js';

// Restart the Puppeteer/Chromium browser instance nightly to reclaim memory that
// accumulates over time (V8 micro-leaks, cached page resources, etc.).
// Runs at 03:00 by default — after the profit-recalculate job (02:00) and before
// morning traffic. Override with BROWSER_RESTART_CRON env var.
const DEFAULT_CRON = process.env.BROWSER_RESTART_CRON || '0 3 * * *';

export function startBrowserRestartJob() {
  try {
    const task = cron.schedule(DEFAULT_CRON, async () => {
      try {
        console.log('[browserRestartJob] restarting Puppeteer browser to reclaim memory');
        await restartBrowser();
        console.log('[browserRestartJob] browser restarted successfully');
      } catch (err) {
        console.error('[browserRestartJob] error during restart', err);
      }
    }, { scheduled: true });

    console.log(`[browserRestartJob] scheduled with cron '${DEFAULT_CRON}'`);
    return task;
  } catch (err) {
    console.error('[browserRestartJob] failed to schedule', err);
    return null;
  }
}

export default startBrowserRestartJob;
