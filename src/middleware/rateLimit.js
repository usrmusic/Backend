/* Minimal fixed-window rate limiter.

   Deliberately dependency-free and in-memory: adequate for the current
   single-instance Railway deploy and adds nothing to the deploy that could
   fail on go-live. If the app is ever scaled horizontally, swap the Map for a
   shared store (Redis) — each instance currently keeps its own counters.

   Used to blunt credential brute-force on the login endpoint. Login accepts a
   legacy plaintext-comparison fallback, so an unthrottled /auth is directly
   brute-forceable; this caps attempts per client IP per window. */

const buckets = new Map();

// Periodically drop expired buckets so the Map can't grow unbounded from a
// spray of unique IPs. unref so it never keeps the process alive on shutdown.
const SWEEP_MS = 5 * 60 * 1000;
const sweeper = setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
  }
}, SWEEP_MS);
sweeper.unref?.();

function clientKey(req, prefix) {
  // req.ip is only trustworthy with `trust proxy` set (see app.js). Fall back to
  // the socket address so a missing header can never make the key undefined.
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${prefix}:${ip}`;
}

/**
 * @param {object} opts
 * @param {number} opts.windowMs   window length in ms
 * @param {number} opts.max        max requests per window per key
 * @param {string} opts.prefix     bucket namespace (so different routes don't share counters)
 * @param {(req)=>string} [opts.keyGenerator]  optional extra key material (e.g. email)
 */
export default function rateLimit({ windowMs, max, prefix = 'rl', keyGenerator } = {}) {
  return function rateLimitMiddleware(req, res, next) {
    const extra = keyGenerator ? `:${keyGenerator(req) || ''}` : '';
    const key = clientKey(req, prefix) + extra;
    const now = Date.now();

    let b = buckets.get(key);
    if (!b || now > b.resetAt) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;

    const remaining = Math.max(0, max - b.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (b.count > max) {
      const retryAfter = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'too_many_requests', retryAfter });
    }
    return next();
  };
}
