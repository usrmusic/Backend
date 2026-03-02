import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from 'fs';

const REGION = process.env.AWS_REGION;
const BUCKET = process.env.AWS_S3_BUCKET_NAME;

const s3Client = new S3Client({
  region: REGION,
  credentials: process.env.AWS_ACCESS_KEY_ID
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined,
});

export async function uploadStreamToS3(streamOrBuffer, key, contentType, opts = {}) {
  const body = streamOrBuffer;
  const params = {
    Bucket: BUCKET,
    Key: key,
    Body: body,
    ContentType: contentType,
    ACL: 'private',
  };
  // optional metadata
  if (opts.metadata && typeof opts.metadata === 'object') params.Metadata = opts.metadata;
  // optional tags (object -> key1=val1&key2=val2)
  if (opts.tags && typeof opts.tags === 'object') {
    const tagPairs = Object.entries(opts.tags).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
    params.Tagging = tagPairs.join('&');
  }
  const command = new PutObjectCommand(params);
  await s3Client.send(command);
  return { key };
}

export async function getSignedGetUrl(key, expiresInSeconds = 60 * 60 * 24 * 7) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}

export async function deleteObjectFromS3(key) {
  if (!key) return;
  const cmd = new DeleteObjectCommand({ Bucket: BUCKET, Key: key });
  await s3Client.send(cmd);
}

export default s3Client;
