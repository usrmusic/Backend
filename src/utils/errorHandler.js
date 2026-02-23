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
      return res.status(pe.statusCode).json({ error: pe.message });
    }
  }

  // JWT errors
  if (err && err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'token_expired' });
  }
  if (err && err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'invalid_token' });
  }

  // Multer errors
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: err.message || 'file_upload_error' });
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
