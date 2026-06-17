import 'dotenv/config';
import app from './app.js';
import prisma from './utils/prismaClient.js';
import startCompleteEventsJob from './jobs/completeEventsJob.js';
import startRecalculateProfitsJob from './jobs/recalculateProfitsJob.js';
import startBrowserRestartJob from './jobs/restartBrowserJob.js';

const PORT = process.env.PORT || 4000;
const DB_CONNECT_MAX_RETRIES = 5;
const DB_CONNECT_BASE_DELAY_MS = 2000;

// Attempt a SELECT 1 to warm the connection pool before the server accepts
// traffic. Retries with exponential backoff + jitter so multiple instances
// don't all hammer the DB at the same instant (thundering herd).
async function connectWithRetry() {
  for (let attempt = 1; attempt <= DB_CONNECT_MAX_RETRIES; attempt++) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      console.log('[db] connection established');
      return;
    } catch (err) {
      const isLast = attempt === DB_CONNECT_MAX_RETRIES;
      if (isLast) {
        console.error(`[db] could not connect after ${DB_CONNECT_MAX_RETRIES} attempts — aborting`);
        console.error(err.message);
        process.exit(1);
      }
      const base = DB_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1);
      const delay = Math.floor(base * (0.5 + Math.random()));
      console.warn(`[db] attempt ${attempt} failed — retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

// Prevent unhandled promise rejections (e.g. from cron jobs or background work)
// from crashing the process. Log and continue.
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

// Catch synchronous throws that escape all error boundaries.
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  // Only exit for truly fatal errors, not operational ones (DB timeouts, pool exhausted, etc.)
  if (err?.code && /^P\d{4}$/.test(err.code)) return; // Prisma error — survivable
  process.exit(1);
});

async function start() {
  await connectWithRetry();

  const server = app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });

  // start background jobs only after DB is confirmed reachable
  const completeEventsTask = startCompleteEventsJob();
  const recalcProfitsTask = startRecalculateProfitsJob();
  const browserRestartTask = startBrowserRestartJob();

  server.on('error', async (err) => {
    console.error('Server error', err);
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use.`);
    }
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  });

  async function shutdown(signal) {
    console.log(`Received ${signal}, closing server...`);
    server.close(async () => {
      await prisma.$disconnect().catch(() => {});
      console.log('Prisma disconnected, exiting.');
      process.exit(0);
    });
    setTimeout(() => {
      console.warn('Forcing shutdown.');
      process.exit(1);
    }, 30_000);
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  process.on('exit', () => {
    try {
      if (typeof completeEventsTask?.stop === 'function') completeEventsTask.stop();
      if (typeof recalcProfitsTask?.stop === 'function') recalcProfitsTask.stop();
      if (typeof browserRestartTask?.stop === 'function') browserRestartTask.stop();
    } catch (_) {}
  });
}

start();
