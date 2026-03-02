import cron from 'node-cron';
import prisma from '../utils/prismaClient.js';

// Schedule a job to mark past confirmed events as completed.
// Config via env:
// - COMPLETE_EVENTS_CRON : cron spec (default: '0 0 * * *' daily at 00:00)
// - CONFIRMED_STATUS_ID : numeric id that represents 'confirmed' (default 2)
// - COMPLETED_STATUS_ID : numeric id that represents 'completed' (default 3)

const DEFAULT_CRON = process.env.COMPLETE_EVENTS_CRON || '0 0 * * *';
const CONFIRMED_STATUS = Number(process.env.CONFIRMED_STATUS_ID || 2);
const COMPLETED_STATUS = Number(process.env.COMPLETED_STATUS_ID || 3);

async function completePastEvents() {
  try {
    const today = new Date();
    // Compare only date portion: events with date < today
    const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    // find events that are confirmed and have a date strictly before today
    const events = await prisma.event.findMany({ where: { event_status_id: CONFIRMED_STATUS, date: { lt: cutoff } }, select: { id: true, date: true } });
    if (!events || !events.length) {
      console.log('[completeEventsJob] no past confirmed events to complete');
      return;
    }

    const ids = events.map(e => e.id);
    const result = await prisma.event.updateMany({ where: { id: { in: ids } }, data: { event_status_id: COMPLETED_STATUS } });
    console.log(`[completeEventsJob] marked ${result.count || 0} events as completed (ids: ${ids.slice(0,10).join(',')}${ids.length>10?',...':''})`);
  } catch (err) {
    console.error('[completeEventsJob] error completing events', err);
  }
}

export function startCompleteEventsJob() {
  try {
    const task = cron.schedule(DEFAULT_CRON, () => {
      console.log('[completeEventsJob] running scheduled job');
      completePastEvents();
    }, { scheduled: true });

    console.log(`[completeEventsJob] scheduled with cron '${DEFAULT_CRON}' (confirmed=${CONFIRMED_STATUS} -> completed=${COMPLETED_STATUS})`);
    return task;
  } catch (e) {
    console.error('[completeEventsJob] failed to schedule job', e);
    return null;
  }
}

export default startCompleteEventsJob;
