import assert from "node:assert/strict";
import test from "node:test";
import * as rateLimitModule from "./rate-limit";

type TestRateLimiter = {
  checkRateLimit(key: string, maxAttempts: number, windowMs: number): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  };
  resetRateLimit(key: string): boolean;
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

test("rate limiter safely resets one fingerprinted bucket without growing storage", () => {
  const limiter = createTestLimiter({ maxBuckets: 2, now: () => 1_000 });

  limiter.checkRateLimit("dashboard-login-ip:192.0.2.10", 100, 60_000);
  limiter.checkRateLimit("dashboard-login:192.0.2.10:dashboard:28", 10, 60_000);
  assert.equal(limiter.size(), 2);

  assert.equal(limiter.resetRateLimit("dashboard-login-ip:192.0.2.10"), true);
  assert.equal(limiter.size(), 1);
  assert.equal(limiter.resetRateLimit("dashboard-login-ip:192.0.2.10"), false);
  assert.equal(limiter.size(), 1);
});
