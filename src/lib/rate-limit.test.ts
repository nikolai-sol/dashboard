import assert from "node:assert/strict";
import test from "node:test";
import * as rateLimitModule from "./rate-limit";

type TestRateLimiter = {
  checkRateLimit(key: string, maxAttempts: number, windowMs: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  };
  size(): number;
};

type CreateRateLimiter = (options: {
  maxBuckets: number;
  now: () => number;
}) => TestRateLimiter;

function createTestLimiter(options: { maxBuckets: number; now: () => number }) {
  const createRateLimiter = (
    rateLimitModule as unknown as { createRateLimiter?: CreateRateLimiter }
  ).createRateLimiter;
  assert.equal(typeof createRateLimiter, "function");
  return (createRateLimiter as CreateRateLimiter)(options);
}

test("rate limiter prunes expired buckets before allocating a new key", () => {
  let now = 1_000;
  const limiter = createTestLimiter({ maxBuckets: 2, now: () => now });

  limiter.checkRateLimit("first", 10, 1_000);
  limiter.checkRateLimit("second", 10, 1_000);
  assert.equal(limiter.size(), 2);

  now = 2_001;
  assert.equal(limiter.checkRateLimit("third", 10, 1_000).allowed, true);
  assert.equal(limiter.size(), 1);
});

test("rate limiter fails closed without exceeding its unique bucket bound", () => {
  const limiter = createTestLimiter({ maxBuckets: 2, now: () => 1_000 });

  assert.equal(limiter.checkRateLimit("first", 10, 1_000).allowed, true);
  assert.equal(limiter.checkRateLimit("second", 10, 1_000).allowed, true);
  const overflow = limiter.checkRateLimit("third", 10, 1_000);

  assert.equal(overflow.allowed, false);
  assert.equal(overflow.remaining, 0);
  assert.ok(overflow.retryAfterSec >= 1);
  assert.equal(limiter.size(), 2);
});

test("rate limiter fingerprints arbitrarily long caller keys to fixed-length storage keys", () => {
  const fingerprintRateLimitKey = (
    rateLimitModule as unknown as {
      fingerprintRateLimitKey?: (key: string) => string;
    }
  ).fingerprintRateLimitKey;
  assert.equal(typeof fingerprintRateLimitKey, "function");
  const fingerprintKey = fingerprintRateLimitKey as (key: string) => string;

  const rawKey = `dashboard-login:${"attacker-controlled-identifier".repeat(10_000)}`;
  const fingerprint = fingerprintKey(rawKey);

  assert.equal(fingerprint.length, 64);
  assert.doesNotMatch(fingerprint, /attacker-controlled-identifier/);
  assert.equal(fingerprintKey(rawKey), fingerprint);
});
