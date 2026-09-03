import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

// Compact signed token: base64url(claimsJSON).base64url(ed25519-signature).
// Self-verifying — the public verify page needs only the public key, not the DB, to trust the payload.

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const privateKeyFrom = (base64) => createPrivateKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'pkcs8' });
const publicKeyFrom = (base64) => createPublicKey({ key: Buffer.from(base64, 'base64'), format: 'der', type: 'spki' });

export function createReleaseSigner({ privateKey, publicKey, keyId }) {
  const priv = privateKey ? privateKeyFrom(privateKey) : null;
  const pub = publicKey ? publicKeyFrom(publicKey) : null;
  return {
    keyId,
    configured: Boolean(priv),
    sign(claims) {
      if (!priv) throw new Error('Release signing key is not configured.');
      const payload = b64url(JSON.stringify({ ...claims, kid: keyId }));
      return `${payload}.${b64url(sign(null, Buffer.from(payload), priv))}`;
    },
    verify(token) {
      if (!pub) return { valid: false, reason: 'no_key' };
      const [payload, signature] = String(token || '').split('.');
      if (!payload || !signature) return { valid: false, reason: 'malformed' };
      let ok = false;
      try { ok = verify(null, Buffer.from(payload), pub, Buffer.from(signature, 'base64url')); } catch { ok = false; }
      if (!ok) return { valid: false, reason: 'bad_signature' };
      let claims;
      try { claims = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return { valid: false, reason: 'malformed' }; }
      if (claims.exp && Date.parse(claims.exp) <= Date.now()) return { valid: false, reason: 'expired', claims };
      return { valid: true, claims };
    },
  };
}
