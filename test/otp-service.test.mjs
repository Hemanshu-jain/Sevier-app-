import test from 'node:test';
import assert from 'node:assert/strict';
import { createOtpService, normalizeIndiaMobile } from '../server/otp-service.mjs';

test('normalizes supported Indian mobile numbers', () => {
  assert.equal(normalizeIndiaMobile('98765 43210'), '919876543210');
  assert.equal(normalizeIndiaMobile('+91-98765-43210'), '919876543210');
  assert.throws(() => normalizeIndiaMobile('12345'), /valid Indian mobile/);
});

test('sends an OTP through MSG91 without exposing credentials in the response', async () => {
  const calls = [];
  const otp = createOtpService({
    authKey: 'secret-auth-key',
    templateId: 'template-1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ type: 'success', request_id: 'request-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  assert.deepEqual(await otp.send('+91 98765 43210'), { requestId: 'request-1' });
  assert.equal(calls[0].options.method, 'POST');
  assert.match(calls[0].url, /^https:\/\/control\.msg91\.com\/api\/v5\/otp\?/);
  assert.match(calls[0].url, /mobile=919876543210/);
  assert.match(calls[0].url, /template_id=template-1/);
  assert.match(calls[0].url, /authkey=secret-auth-key/);
});

test('verifies only numeric OTP values through MSG91', async () => {
  const calls = [];
  const otp = createOtpService({
    authKey: 'secret-auth-key',
    templateId: 'template-1',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ type: 'success', message: 'OTP verified success' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await assert.rejects(() => otp.verify('9876543210', '12ab'), /4 to 8 digits/);
  assert.deepEqual(await otp.verify('9876543210', '123456'), { verified: true });
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.headers.authkey, 'secret-auth-key');
  assert.match(calls[0].url, /\/api\/v5\/otp\/verify\?/);
  assert.match(calls[0].url, /otp=123456/);
  assert.doesNotMatch(calls[0].url, /authkey/);
});

test('turns provider rejections into safe errors', async () => {
  const otp = createOtpService({
    authKey: 'secret-auth-key',
    templateId: 'template-1',
    fetchImpl: async () => new Response(JSON.stringify({ type: 'error', message: 'Invalid OTP' }), { status: 200 }),
  });

  await assert.rejects(() => otp.verify('9876543210', '123456'), /Invalid OTP/);
});
