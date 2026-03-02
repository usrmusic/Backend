import 'dotenv/config';
import app from './app.js';
import prisma from './utils/prismaClient.js';
import startCompleteEventsJob from './jobs/completeEventsJob.js';

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// start background jobs
const completeEventsTask = startCompleteEventsJob();

// Handle listen errors (e.g., port already in use)
server.on('error', async (err) => {
  console.error('Server error', err);
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use.`);
  }
  try {
    await prisma.$disconnect();
    console.log('Prisma disconnected after server error');
  } catch (e) {
    // ignore
  }
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, closing server...`);
  server.close(async () => {
    try {
      await prisma.$disconnect();
      console.log('Prisma disconnected, exiting.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown', err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.warn('Forcing shutdown.');
    process.exit(1);
  }, 30_000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// stop background tasks on exit
process.on('exit', () => {
  try {
    if (completeEventsTask && typeof completeEventsTask.stop === 'function') completeEventsTask.stop();
  } catch (e) {
    // ignore
  }
});
