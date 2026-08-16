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
    // Email-verification and password tokens are signed with the same secret but
    // are NOT sessions. Reject any non-access token here so a verification link
    // (which is emailed, and returned in some API responses) can't be replayed
    // as a bearer session. Access tokens carry no `typ`, so this only blocks the
    // purpose-tagged ones.
    if (decoded && decoded.typ && decoded.typ !== 'access') {
      return res.status(401).json({ error: 'invalid_token', details: 'wrong_token_type' });
    }
    req.user = decoded;
    return next();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_token', details: err.message });
  }
}
