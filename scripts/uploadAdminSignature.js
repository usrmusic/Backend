/**
 * Upload admin signature image to S3 and update company_names.admin_signature in the DB.
 *
 * Usage:
 *   node -r dotenv/config -r dotenv-flow/config scripts/uploadAdminSignature.js <image-path> [company-id]
 *
 * With env-cmd (matches npm run dev):
 *   npx env-cmd -f .env.local node scripts/uploadAdminSignature.js <image-path> [company-id]
 *
 * Arguments:
 *   image-path   — path to the signature image (relative to Backend/)
 *   company-id   — (optional) company_names.id to update; defaults to the first row
 *
 * Example:
 *   npx env-cmd -f .env.local node scripts/uploadAdminSignature.js scripts/admin_ignature.png
 */

import fs from 'fs';
import path from 'path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import mysql from 'mariadb';

const [, , imagePath, companyIdArg] = process.argv;

if (!imagePath) {
  console.error('Usage: npx env-cmd -f .env.local node scripts/uploadAdminSignature.js <image-path> [company-id]');
  process.exit(1);
}

const resolved = path.resolve(process.cwd(), imagePath);
if (!fs.existsSync(resolved)) {
  console.error(`File not found: ${resolved}`);
  process.exit(1);
}

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET_NAME;
const DATABASE_URL = process.env.DATABASE_URL;

if (!REGION || !BUCKET) {
  console.error('Missing AWS_REGION or AWS_S3_BUCKET_NAME in environment.');
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment.');
  process.exit(1);
}

// Parse DATABASE_URL → mariadb connection options
function parseDatabaseUrl(url) {
  const u = new URL(url);
  const params = Object.fromEntries(u.searchParams.entries());
  return {
    host: u.hostname,
    port: Number(u.port) || 3306,
    user: u.username,
    password: decodeURIComponent(u.password),
    database: u.pathname.replace(/^\//, ''),
    ssl: { rejectUnauthorized: false },
    connectionLimit: 3,
  };
}

const ext = path.extname(resolved).toLowerCase().replace('.', '') || 'png';
const mimeMap = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' };
const contentType = mimeMap[ext] || 'image/png';

async function run() {
  // 1. Upload to S3
  const s3 = new S3Client({
    region: REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  });

  const s3Key = `signatures/admin_signature_${Date.now()}.${ext}`;
  const buffer = fs.readFileSync(resolved);

  console.log(`Uploading to s3://${BUCKET}/${s3Key} ...`);
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: s3Key,
    Body: buffer,
    ContentType: contentType,
  }));
  console.log('S3 upload successful.');

  // 2. Update DB
  const pool = mysql.createPool(parseDatabaseUrl(DATABASE_URL));
  let conn;
  try {
    conn = await pool.getConnection();

    // Find company row
    let companyId;
    let companyName;
    if (companyIdArg) {
      const rows = await conn.query('SELECT id, name FROM company_names WHERE id = ? LIMIT 1', [companyIdArg]);
      if (!rows.length) {
        console.error(`No company_names row found with id=${companyIdArg}`);
        process.exit(1);
      }
      companyId = rows[0].id;
      companyName = rows[0].name;
    } else {
      const rows = await conn.query('SELECT id, name FROM company_names ORDER BY id ASC LIMIT 1');
      if (!rows.length) {
        console.error('No rows found in company_names table.');
        process.exit(1);
      }
      companyId = rows[0].id;
      companyName = rows[0].name;
    }

    console.log(`Updating company [${companyId}] "${companyName}" ...`);
    await conn.query('UPDATE company_names SET admin_signature = ? WHERE id = ?', [s3Key, companyId]);
    console.log(`DB updated — admin_signature = "${s3Key}"`);
  } finally {
    if (conn) conn.release();
    await pool.end();
  }

  // 3. Print presigned URL to verify
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: s3Key });
    const url = await getSignedUrl(s3, cmd, { expiresIn: 60 * 60 * 24 * 7 });
    console.log(`\nPresigned URL (7-day — open in browser to verify):\n${url}`);
  } catch (e) {
    console.log('(Could not generate presigned URL:', e.message, ')');
  }

  console.log('\nDone. Restart the backend server if it caches company data.');
}

run().catch((err) => {
  console.error('Script failed:', err.message || err);
  process.exit(1);
});
