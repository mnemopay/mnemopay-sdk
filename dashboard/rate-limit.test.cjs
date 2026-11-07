const assert = require('assert');
const { createRateLimiter, clientKeyForRequest } = require('./rate-limit.cjs');

function main() {
  let t = 0;
  const limiter = createRateLimiter({ capacity: 3, refillPerSec: 1, sweepMs: 1000, now: () => t });

  // First three consumes succeed.
  assert.strictEqual(limiter.consume('a').ok, true);
  assert.strictEqual(limiter.consume('a').ok, true);
  assert.strictEqual(limiter.consume('a').ok, true);
  const denied = limiter.consume('a');
  assert.strictEqual(denied.ok, false);
  assert.strictEqual(denied.retryAfterSec, 1);

  // Refill over time.
  t += 2000;
  const refilled = limiter.consume('a');
  assert.strictEqual(refilled.ok, true);

  // Different key has its own bucket.
  assert.strictEqual(limiter.consume('b').ok, true);
  assert.strictEqual(limiter.peek('b').remaining >= 2, true);

  // Cap respects capacity.
  t += 100_000;
  const peek = limiter.peek('a');
  assert.strictEqual(peek.remaining, 3);

  // Client key: never the client-controlled (leftmost) X-Forwarded-For entry.
  // One trusted proxy hop (default) => the RIGHTMOST entry, which the proxy appended.
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }, socket: {} }, { trustedProxyHops: 1 }),
    '5.6.7.8',
  );
  // A spoofing client cannot pick its bucket by prepending entries.
  const real = clientKeyForRequest({ headers: { 'x-forwarded-for': '203.0.113.7' }, socket: {} }, { trustedProxyHops: 1 });
  const spoof = clientKeyForRequest({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' }, socket: {} }, { trustedProxyHops: 1 });
  assert.strictEqual(real, '203.0.113.7');
  assert.strictEqual(spoof, real);
  // Two hops (e.g. CDN + platform edge): second from the right.
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'x-forwarded-for': 'evil, 198.51.100.9, 10.1.1.1' }, socket: {} }, { trustedProxyHops: 2 }),
    '198.51.100.9',
  );
  // fly-client-ip is spoofable off Fly, so it is ignored unless explicitly trusted.
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'fly-client-ip': '9.9.9.9' }, socket: { remoteAddress: '10.0.0.5' } }, { trustedProxyHops: 1 }),
    '10.0.0.5',
  );
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'fly-client-ip': '9.9.9.9' }, socket: {} }, { trustFlyClientIp: true }),
    '9.9.9.9',
  );
  // hops=0 ignores XFF entirely; too-short XFF falls back to the socket.
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } }, { trustedProxyHops: 0 }),
    '127.0.0.1',
  );
  assert.strictEqual(
    clientKeyForRequest({ headers: { 'x-forwarded-for': '1.2.3.4' }, socket: { remoteAddress: '127.0.0.1' } }, { trustedProxyHops: 2 }),
    '127.0.0.1',
  );
  assert.strictEqual(
    clientKeyForRequest({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }),
    '127.0.0.1',
  );

  clearInterval(limiter._sweepTimer);
  console.log('rate-limit.test.cjs OK');
}

main();
