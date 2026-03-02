import prisma from '../src/utils/prismaClient.js';
import { pruneExpiredFiles } from '../src/utils/uploadHelper.js';

async function run() {
  try {
    const n = await pruneExpiredFiles(prisma);
    console.log(`Pruned ${n} expired uploads`);
  } catch (e) {
    console.error('Prune failed', e);
    process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

run();
