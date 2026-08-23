// Lightweight in-memory rate limiter for public, unauthenticated write routes
// (currently just the website enquiry form). Mirrors the pattern already used
// for the permission cache (authorize.js) — an in-memory Map with a TTL —
// rather than pulling in a new dependency for a single low-traffic route.
// Resets on restart; fine for a single-instance deploy. Roughly matches the
// Laravel public endpoint's own throttle:api limit (60/min/IP).
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 10;

const hits = new Map(); // ip -> { count, windowStart }

function sweep(now) {
  for (const [ip, entry] of hits) {
    if (now - entry.windowStart > WINDOW_MS) hits.delete(ip);
  }
}

export function publicRateLimit(req, res, next) {
  const ip = req.ip || req.connection?.remoteAddress || "unknown";
  const now = Date.now();
  sweep(now);

  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX_REQUESTS) {
    return res.status(429).json({ error: "too_many_requests" });
  }
  return next();
}

export default publicRateLimit;
