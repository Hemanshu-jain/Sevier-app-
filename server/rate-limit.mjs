// Minimal in-memory fixed-window rate limiter — no dependency, protects the
// unauthenticated endpoints (OTP request/verify, public pass verify) from abuse.
// ponytail: single-instance only. If the API scales horizontally, move the
// counters to Redis/DB so the window is shared across instances.

const buckets = new Map(); // key -> { count, resetAt }

function sweep(now) {
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

// Identify the caller by IP. Uses Express's req.ip (which reflects X-Forwarded-For only
// when the operator sets `trust proxy`, so it can't be spoofed on a directly-exposed API),
// and falls back to the socket address, then a constant so a missing IP still shares one bucket.
export function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

export function rateLimit({ windowMs, max, key = clientKey, now = () => Date.now() }) {
  return function rateLimiter(req, res, next) {
    const currentTime = now();
    if (buckets.size > 5000) sweep(currentTime);
    const bucketKey = String(key(req));
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= currentTime) { bucket = { count: 0, resetAt: currentTime + windowMs }; buckets.set(bucketKey, bucket); }
    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - currentTime) / 1000)));
      return res.status(429).json({ error: 'Too many requests. Please wait a moment and try again.' });
    }
    return next();
  };
}
