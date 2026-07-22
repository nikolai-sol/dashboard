import crypto from "node:crypto";

type Bucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_MAX_BUCKETS = 10_000;

type RateLimiterOptions = {
  maxBuckets?: number;
  now?: () => number;
};

export function fingerprintRateLimitKey(key: string) {
  return crypto.createHash("sha256").update(key, "utf8").digest("hex");
}

export function createRateLimiter(options: RateLimiterOptions = {}) {
  const buckets = new Map<string, Bucket>();
  const maxBuckets = options.maxBuckets ?? DEFAULT_MAX_BUCKETS;
  const nowMs = options.now ?? Date.now;

  if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) {
    throw new Error("maxBuckets must be a positive integer");
  }

  function pruneExpired(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function checkRateLimit(key: string, maxAttempts: number, windowMs: number) {
    const now = nowMs();
    pruneExpired(now);
    const storageKey = fingerprintRateLimitKey(key);
    const current = buckets.get(storageKey);
    if (!current) {
      if (buckets.size >= maxBuckets) {
        const earliestReset = Math.min(...Array.from(buckets.values(), (bucket) => bucket.resetAt));
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(Math.ceil((earliestReset - now) / 1000), 1),
        };
      }
      buckets.set(storageKey, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxAttempts - 1, retryAfterSec: 0 };
    }

    if (current.count >= maxAttempts) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.max(Math.ceil((current.resetAt - now) / 1000), 1),
      };
    }

    current.count += 1;
    buckets.set(storageKey, current);
    return { allowed: true, remaining: Math.max(maxAttempts - current.count, 0), retryAfterSec: 0 };
  }

  function resetRateLimit(key: string) {
    return buckets.delete(fingerprintRateLimitKey(key));
  }

  return {
    checkRateLimit,
    resetRateLimit,
    size: () => buckets.size,
  };
}

const defaultRateLimiter = createRateLimiter();

export const checkRateLimit = defaultRateLimiter.checkRateLimit;
export const resetRateLimit = defaultRateLimiter.resetRateLimit;
