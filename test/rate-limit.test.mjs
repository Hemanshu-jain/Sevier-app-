import test from 'node:test';
import assert from 'node:assert/strict';
import { rateLimit } from '../server/rate-limit.mjs';

function fakeRes() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    setHeader(name, value) { this.headers[name] = value; },
  };
}

test('allows up to max requests then returns 429, and resets after the window', () => {
  let now = 1_000_000;
  const limiter = rateLimit({ windowMs: 1000, max: 2, key: () => 'same-ip', now: () => now });
  const call = () => { const res = fakeRes(); let passed = false; limiter({}, res, () => { passed = true; }); return { res, passed }; };

  assert.equal(call().passed, true, 'first request passes');
  assert.equal(call().passed, true, 'second request passes');
  const third = call();
  assert.equal(third.passed, false, 'third request is blocked');
  assert.equal(third.res.statusCode, 429);
  assert.ok(third.res.headers['Retry-After'], 'sets Retry-After');

  now += 1001; // advance past the window
  assert.equal(call().passed, true, 'request passes again after the window resets');
});

test('separate keys have independent budgets', () => {
  let ip = 'a';
  const limiter = rateLimit({ windowMs: 1000, max: 1, key: () => ip, now: () => 5000 });
  const call = () => { let passed = false; limiter({}, fakeRes(), () => { passed = true; }); return passed; };

  assert.equal(call(), true, 'ip a first request passes');
  assert.equal(call(), false, 'ip a second request blocked');
  ip = 'b';
  assert.equal(call(), true, 'ip b has its own budget');
});
