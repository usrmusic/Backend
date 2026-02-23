import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  // Fail fast in development if secret missing
  console.warn('JWT_SECRET is not set; verifyAccessToken will fail at runtime');
}

export function verifyAccessToken(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'missing_token' });
  const token = auth.split(' ')[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', details: err.message });
  }
}
