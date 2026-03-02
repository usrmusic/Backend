import prisma from './prismaClient.js';

// Log activity into `activity_log` table if present. Uses Prisma raw SQL to avoid requiring a model.
export async function logActivity(clientOrTx, { log_name = 'default', description = '', subject_type = null, subject_id = null, causer_id = null, properties = null } = {}) {
  const db = clientOrTx || prisma;
  try {
    // properties as JSON string
    const props = properties ? JSON.stringify(properties) : null;
    // Use parameterized query via Prisma tag
    await db.$executeRaw`
      INSERT INTO activity_log (log_name, description, subject_type, subject_id, causer_id, properties, created_at, updated_at)
      VALUES (${log_name}, ${description}, ${subject_type}, ${subject_id}, ${causer_id}, ${props}, NOW(), NOW())`;
  } catch (e) {
    // If table doesn't exist or insert fails, swallow error to avoid breaking main flow
    // Optionally, you could fallback to console logging
    try { console.warn('activity_log write failed', e.message || e); } catch(_){}
  }
}

export default { logActivity };
