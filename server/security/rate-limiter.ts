interface RateLimitEntry {
  timestamps: number[];
}

const rateLimitBuckets = new Map<string, RateLimitEntry>();

// Cleanup stale buckets periodically (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitBuckets.entries()) {
    entry.timestamps = entry.timestamps.filter(t => now - t < 300000);
    if (entry.timestamps.length === 0) {
      rateLimitBuckets.delete(key);
    }
  }
}, 300000).unref();

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; remaining: number; resetMs: number } {
  const now = Date.now();
  let entry = rateLimitBuckets.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitBuckets.set(key, entry);
  }

  // Remove timestamps outside window
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0];
    const resetMs = Math.max(0, windowMs - (now - oldest));
    return { allowed: false, remaining: 0, resetMs };
  }

  entry.timestamps.push(now);
  return {
    allowed: true,
    remaining: maxRequests - entry.timestamps.length,
    resetMs: windowMs
  };
}

export function resetRateLimits(): void {
  rateLimitBuckets.clear();
}
