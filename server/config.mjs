const developmentDefaults = {
  DATABASE_URL: 'postgresql://handoff:handoff@127.0.0.1:5432/handoff',
  SESSION_SECRET: 'local-development-session-secret-change-me',
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  OBJECT_STORAGE_BUCKET: 'handoff-development',
  PUBLIC_WEB_URL: 'http://127.0.0.1:8787',
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');

  const value = (name) => env[name] || (nodeEnv === 'production' ? '' : developmentDefaults[name] || '');
  const required = ['DATABASE_URL', 'SESSION_SECRET', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID', 'PUBLIC_WEB_URL'];
  const missing = nodeEnv === 'production' ? required.filter((name) => !value(name)) : [];
  if (missing.length) throw new Error(`Missing production settings: ${missing.join(', ')}`);

  const sessionSecret = value('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters.');

  return {
    nodeEnv,
    port,
    databaseUrl: value('DATABASE_URL'),
    sessionSecret,
    objectStorageEndpoint: value('OBJECT_STORAGE_ENDPOINT'),
    objectStorageBucket: value('OBJECT_STORAGE_BUCKET'),
    msg91AuthKey: value('MSG91_AUTH_KEY'),
    msg91OtpTemplateId: value('MSG91_OTP_TEMPLATE_ID'),
    publicWebUrl: value('PUBLIC_WEB_URL'),
  };
}
