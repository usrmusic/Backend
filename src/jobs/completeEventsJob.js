import cron from 'node-cron';
import prisma from '../utils/prismaClient.js';
import { toMoney, isFullyPaid } from '../utils/money.js';
import services from '../services/index.js';
import { logActivity } from '../utils/activityLogger.js';

// Schedule a job to mark past confirmed events as completed.
// Config via env:
// - COMPLETE_EVENTS_CRON : cron spec (default: '0 0 * * *' daily at 00:00)
// - CONFIRMED_STATUS_ID : numeric id that represents 'confirmed' (default 2)
// - COMPLETED_STATUS_ID : numeric id that represents 'completed' (default 3)
//
// Parity with the legacy Laravel `update:completedEvents` command
// (usrmusic_rep/app/Console/Commands/UpdateCompletedEvents.php +
// usrmusic_rep/app/Services/{EventService,UserService}.php). For every past
// confirmed event this job:
//   1. Computes `is_event_payment_fully_paid` (sum of event_payments.amount
//      vs total_cost_for_equipment) and marks the event completed.
//   2. Auto-closes every Todo attached to that event.
//   3. Soft-deletes the event's client user if they have no other open
//      enquiry (event_status_id = 1) left.

const DEFAULT_CRON = process.env.COMPLETE_EVENTS_CRON || '0 0 * * *';
const CONFIRMED_STATUS = Number(process.env.CONFIRMED_STATUS_ID || 2);
const COMPLETED_STATUS = Number(process.env.COMPLETED_STATUS_ID || 3);
const OPEN_ENQUIRY_STATUS = 1;
const CLIENT_ROLE_ID = 4n;

const userSvc = services.get('user');

async function completePastEvents() {
  try {
    const today = new Date();
    // Compare only date portion: events with date < today
    const cutoff = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

    // find events that are confirmed and have a date strictly before today
    const events = await prisma.event.findMany({
      where: { event_status_id: CONFIRMED_STATUS, date: { lt: cutoff } },
      select: { id: true, date: true, user_id: true, total_cost_for_equipment: true },
    });
    if (!events || !events.length) {
      console.log('[completeEventsJob] no past confirmed events to complete');
      return;
    }

    const ids = events.map((e) => e.id);
    let completedCount = 0;

    // Steps 1-2: per event, compute the fully-paid flag then mark completed.
    // Done per-event (rather than one bulk update) since each event's
    // payment total is independent and one bad record must not abort the rest.
    for (const event of events) {
      try {
        const paidAgg = await prisma.eventPayment.aggregate({
          where: { event_id: event.id },
          _sum: { amount: true },
        });
        const totalPaid = toMoney(paidAgg?._sum?.amount);
        const fullyPaid = isFullyPaid(totalPaid, event.total_cost_for_equipment);

        await prisma.event.update({
          where: { id: event.id },
          data: {
            is_event_payment_fully_paid: fullyPaid,
            event_status_id: COMPLETED_STATUS,
          },
        });
        completedCount += 1;
      } catch (err) {
        console.error(`[completeEventsJob] failed to complete event ${event.id}`, err);
      }
    }

    // Step 3: auto-close every todo on these events.
    try {
      const todoResult = await prisma.todos.updateMany({
        where: { event_id: { in: ids } },
        data: { complete: true },
      });
      console.log(`[completeEventsJob] auto-completed ${todoResult.count || 0} todos for events ${ids.slice(0, 10).join(',')}${ids.length > 10 ? ',...' : ''}`);
    } catch (err) {
      console.error('[completeEventsJob] failed to auto-complete todos', err);
    }

    // Step 4: soft-delete clients with no remaining open enquiry.
    // Only role_id 4 (Client) is eligible — never touch staff/DJ/admin users
    // who happen to be an event's user_id.
    const clientUserIds = [...new Set(events.map((e) => e.user_id).filter((id) => id != null))];
    for (const userId of clientUserIds) {
      try {
        const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role_id: true, deleted_at: true } });
        if (!user || user.deleted_at || user.role_id !== CLIENT_ROLE_ID) continue;

        const hasOpenEnquiry = await prisma.event.findFirst({
          where: { user_id: userId, event_status_id: OPEN_ENQUIRY_STATUS },
          select: { id: true },
        });
        if (hasOpenEnquiry) continue;

        const result = await userSvc.delete(userId);
        console.log(`[completeEventsJob] soft-deleted client user ${userId} (no remaining open enquiries)`);
        await logActivity(prisma, {
          log_name: 'user deleted',
          description: `User ${userId} auto-deleted by completeEventsJob (no remaining open enquiries)`,
          subject_type: 'User',
          subject_id: userId,
          causer_id: null,
          properties: { deletedAt: result?.deleted_at || null },
        });
      } catch (err) {
        console.error(`[completeEventsJob] failed to process client user ${userId}`, err);
      }
    }

    console.log(`[completeEventsJob] marked ${completedCount} events as completed (ids: ${ids.slice(0, 10).join(',')}${ids.length > 10 ? ',...' : ''})`);
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
