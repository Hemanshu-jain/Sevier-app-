import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createReleaseSigner } from '../server/release-signing.mjs';

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64'),
    publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'),
  };
}

test('signs and verifies a release token, and rejects tampering, expiry, and wrong keys', () => {
  const keys = keypair();
  const signer = createReleaseSigner({ ...keys, keyId: 'k_test' });

  const token = signer.sign({ passId: 'RP-1', orgId: 't1', exp: new Date(Date.now() + 60_000).toISOString() });
  const good = signer.verify(token);
  assert.equal(good.valid, true);
  assert.equal(good.claims.passId, 'RP-1');
  assert.equal(good.claims.kid, 'k_test');

  // Tampered payload, original signature → invalid.
  const [, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ passId: 'RP-HACK', kid: 'k_test' })).toString('base64url');
  assert.equal(signer.verify(`${forgedPayload}.${signature}`).valid, false);

  // Expired.
  const expired = signer.verify(signer.sign({ passId: 'RP-2', exp: new Date(Date.now() - 1000).toISOString() }));
  assert.equal(expired.valid, false);
  assert.equal(expired.reason, 'expired');

  // A different key cannot verify this token.
  const stranger = createReleaseSigner({ publicKey: keypair().publicKey, keyId: 'k_other' });
  assert.equal(stranger.verify(token).valid, false);

  // Malformed input.
  assert.equal(signer.verify('not-a-token').valid, false);
});
