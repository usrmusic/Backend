import cron from 'node-cron';
import prisma from '../utils/prismaClient.js';
import { pruneExpiredFiles } from '../utils/uploadHelper.js';

// Deletes file_uploads rows (and their underlying S3/disk objects) whose
// delete_after date has passed. Mirrors the legacy Laravel app's
// `files:deleteExpired` scheduled command, which this Node rewrite had
// dropped — pruneExpiredFiles() itself already existed (used by
// scripts/pruneExpired.js for manual runs) but nothing was scheduling it.
//
// Config via env:
// - PRUNE_EXPIRED_FILES_CRON : cron spec (default: '30 0 * * *' daily at 00:30,
//   matching the Laravel schedule)

const DEFAULT_CRON = process.env.PRUNE_EXPIRED_FILES_CRON || '30 0 * * *';

async function runPruneExpiredFiles() {
  try {
    const count = await pruneExpiredFiles(prisma);
    console.log(`[pruneExpiredFilesJob] pruned ${count} expired file(s)`);
  } catch (err) {
    console.error('[pruneExpiredFilesJob] error pruning expired files', err);
  }
}

export function startPruneExpiredFilesJob() {
  try {
    const task = cron.schedule(DEFAULT_CRON, () => {
      console.log('[pruneExpiredFilesJob] running scheduled job');
      runPruneExpiredFiles();
    }, { scheduled: true });

    console.log(`[pruneExpiredFilesJob] scheduled with cron '${DEFAULT_CRON}'`);
    return task;
  } catch (e) {
    console.error('[pruneExpiredFilesJob] failed to schedule job', e);
    return null;
  }
}

export default startPruneExpiredFilesJob;
