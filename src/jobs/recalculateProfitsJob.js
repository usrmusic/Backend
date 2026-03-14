import cron from 'node-cron';
import dashboardService from '../services/dashboard.service.js';

// Schedule via env var RECALCULATE_PROFITS_CRON (default: daily at 02:00)
const DEFAULT_CRON = process.env.RECALCULATE_PROFITS_CRON || '0 2 * * *';

async function runRecalculate() {
  try {
    console.log('[recalculateProfitsJob] running scheduled profit recalculation');
    const res = await dashboardService.recalculateProfits({ force: false });
    console.log(`[recalculateProfitsJob] updated profits for ${res.updated} events`);
  } catch (err) {
    console.error('[recalculateProfitsJob] error', err);
  }
}

export function startRecalculateProfitsJob() {
  try {
    const task = cron.schedule(DEFAULT_CRON, () => {
      runRecalculate();
    }, { scheduled: true });

    console.log(`[recalculateProfitsJob] scheduled with cron '${DEFAULT_CRON}'`);
    return task;
  } catch (err) {
    console.error('[recalculateProfitsJob] failed to schedule', err);
    return null;
  }
}

export default startRecalculateProfitsJob;
