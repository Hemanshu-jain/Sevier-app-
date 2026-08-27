import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.mjs';

test('production configuration rejects missing security and provider settings', () => {
  assert.throws(
    () => loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://db/handoff' }),
    /SESSION_SECRET, OBJECT_STORAGE_ENDPOINT, OBJECT_STORAGE_BUCKET, MSG91_AUTH_KEY, MSG91_OTP_TEMPLATE_ID, PUBLIC_WEB_URL/,
  );
});

test('configuration validates the port and session-secret length', () => {
  assert.throws(() => loadConfig({ PORT: 'invalid' }), /PORT/);
  assert.throws(() => loadConfig({ SESSION_SECRET: 'short' }), /SESSION_SECRET/);
});

test('development configuration provides local service defaults', () => {
  assert.deepEqual(loadConfig({ NODE_ENV: 'development', PORT: '9000' }), {
    nodeEnv: 'development',
    port: 9000,
    databaseUrl: 'postgresql://handoff:handoff@127.0.0.1:5432/handoff',
    sessionSecret: 'local-development-session-secret-change-me',
    objectStorageEndpoint: 'http://127.0.0.1:9000',
    objectStorageBucket: 'handoff-development',
    msg91AuthKey: '',
    msg91OtpTemplateId: '',
    publicWebUrl: 'http://127.0.0.1:8787',
  });
});
