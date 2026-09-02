import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';

test('production configuration rejects missing security and provider settings', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/handoff' }),
    /OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID, PUBLIC_WEB_URL/,
  );
});

test('configuration validates the port', () => {
  assert.throws(() => loadConfig({ PORT: 'invalid' }), /PORT/);
});

test('development configuration provides local service defaults', () => {
  assert.deepEqual(loadConfig({ NODE_ENV: 'development', PORT: '9000' }), {
    nodeEnv: 'development',
    port: 9000,
    listenHost: '127.0.0.1',
    databaseUrl: 'mysql://handoff:handoff_dev@localhost:3306/handoff_dev',
    objectStorageEndpoint: 'http://127.0.0.1:9000',
    objectStorageBucket: 'handoff-development',
    msg91AuthKey: '',
    msg91OtpTemplateId: '',
    publicWebUrl: 'http://127.0.0.1:8787',
    developmentOtpCode: '123456',
  });
});

test('development API can opt into LAN listening for a debug APK', () => {
  assert.equal(loadConfig({ HANDOFF_API_HOST: '0.0.0.0' }).listenHost, '0.0.0.0');
});

test('development OTP code must remain numeric', () => {
  assert.throws(() => loadConfig({ DEV_OTP_CODE: 'secret' }), /DEV_OTP_CODE/);
});
