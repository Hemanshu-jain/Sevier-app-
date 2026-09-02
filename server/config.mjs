const developmentDefaults = {
  DATABASE_URL: 'mysql://handoff:handoff_dev@localhost:3306/handoff_dev',
  OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:9000',
  OBJECT_STORAGE_BUCKET: 'handoff-development',
  PUBLIC_WEB_URL: 'http://127.0.0.1:8787',
};

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const port = Number(env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');

  const value = (name) => env[name] || (nodeEnv === 'production' ? '' : developmentDefaults[name] || '');
  const required = ['DATABASE_URL', 'OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'MSG91_AUTH_KEY', 'MSG91_OTP_TEMPLATE_ID', 'PUBLIC_WEB_URL'];
  const missing = nodeEnv === 'production' ? required.filter((name) => !value(name)) : [];
  if (missing.length) throw new Error(`Missing production settings: ${missing.join(', ')}`);

  const developmentOtpCode = nodeEnv === 'production' ? '' : (env.DEV_OTP_CODE || '123456');
  if (developmentOtpCode && !/^\d{4,8}$/.test(developmentOtpCode)) throw new Error('DEV_OTP_CODE must contain 4 to 8 digits.');

  return {
    nodeEnv,
    port,
    listenHost: env.HANDOFF_API_HOST || '127.0.0.1',
    databaseUrl: value('DATABASE_URL'),
    objectStorageEndpoint: value('OBJECT_STORAGE_ENDPOINT'),
    objectStorageBucket: value('OBJECT_STORAGE_BUCKET'),
    msg91AuthKey: value('MSG91_AUTH_KEY'),
    msg91OtpTemplateId: value('MSG91_OTP_TEMPLATE_ID'),
    publicWebUrl: value('PUBLIC_WEB_URL'),
    developmentOtpCode,
  };
}
