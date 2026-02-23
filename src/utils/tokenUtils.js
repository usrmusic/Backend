import crypto from 'crypto';

export function generateRandomToken(bytes = 48) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export default { generateRandomToken, hashToken };
