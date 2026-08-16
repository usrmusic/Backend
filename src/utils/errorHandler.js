import AppError from './AppError.js';

function handlePrismaError(err) {
  // handle a few common Prisma errors
  if (err.code === 'P2002') {
    // Unique constraint failed
    const meta = err.meta || {};
    const target = meta.target || 'field';
    return new AppError(`Duplicate value for ${target}`, 409);
  }
  if (err.code === 'P2025') {
    return new AppError('Record not found', 404);
  }
  if (err.code === 'P2003') {
    // Foreign key constraint failed
    const meta = err.meta || {};
    return new AppError('Foreign key constraint violated', 400, meta);
  }
  if (err.code === 'P2024') {
    // Connection pool timeout
    return new AppError('Database connection pool exhausted, please retry', 503);
  }
  if (err.code === 'P2028') {
    // Interactive transaction timeout
    return new AppError('Database transaction timed out, please retry', 503);
  }
  return null;
}

export default function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  // Always log internally
  console.error(err);

  // If already an AppError (operational), use it
  if (err instanceof AppError) {
    const payload = { error: err.message };
    if (err.details) payload.details = err.details;
    if (process.env.NODE_ENV !== 'production') payload.stack = err.stack;
    return res.status(err.statusCode).json(payload);
  }

  // Prisma errors
  if (err && err.code && err.code.startsWith('P')) {
    const pe = handlePrismaError(err);
    if (pe) {
      const payload = { error: pe.message };
      if (pe.details) payload.details = pe.details;
      if (process.env.NODE_ENV !== 'production') payload.stack = pe.stack;
      return res.status(pe.statusCode).json(payload);
    }
  }

  // JWT errors
  if (err && err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'token_expired' });
  }
  if (err && err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Multer errors (incl. file-size limit → LIMIT_FILE_SIZE)
  if (err && err.name === 'MulterError') {
    const tooBig = err.code === 'LIMIT_FILE_SIZE';
    return res.status(tooBig ? 413 : 400).json({ error: tooBig ? 'file_too_large' : (err.message || 'file_upload_error') });
  }

  // body-parser payload-too-large (express.json/urlencoded limit exceeded)
  if (err && (err.type === 'entity.too.large' || err.status === 413)) {
    return res.status(413).json({ error: 'payload_too_large' });
  }

  // Validation libraries often expose .errors or name
  if (err && err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message || 'validation_error' });
  }

  // Fallback: do not leak internal error messages in production
  const isProd = process.env.NODE_ENV === 'production';
  const message = isProd ? 'internal_server_error' : err.message || 'internal_server_error';
  const payload = { error: message };
  if (!isProd) payload.stack = err.stack;

  return res.status(500).json(payload);
}
