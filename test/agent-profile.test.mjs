import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAgentProfile, validAvatar } from '../server/agent-profile.mjs';

const address = { addressLine1: '12 MG Road', addressLine2: 'Near bus stand', pincode: '411001' };

test('agent profile needs an address and, until one is on file, a valid Aadhaar or PAN', () => {
  assert.match(parseAgentProfile({ ...address, pincode: '4110' }, { requireIdProof: false }).error, /pincode/);
  assert.match(parseAgentProfile({ ...address, addressLine1: '' }, { requireIdProof: false }).error, /address/);
  assert.match(parseAgentProfile(address, { requireIdProof: true }).error, /Aadhaar or PAN/);
  assert.equal(parseAgentProfile(address, { requireIdProof: false }).values.idProof, '');
  assert.match(parseAgentProfile({ ...address, idProofType: 'aadhaar', idProof: '1234 5678' }, { requireIdProof: true }).error, /12 digits/);
  assert.match(parseAgentProfile({ ...address, idProofType: 'pan', idProof: '12345' }, { requireIdProof: true }).error, /ABCDE1234F/);
  assert.equal(parseAgentProfile({ ...address, idProofType: 'aadhaar', idProof: '1234 5678 9012' }, { requireIdProof: true }).values.idProof, '123456789012');
  assert.equal(parseAgentProfile({ ...address, idProofType: 'pan', idProof: 'abcde1234f' }, { requireIdProof: true }).values.idProof, 'ABCDE1234F');
});

test('profile photo must be a small image data URL', () => {
  assert.ok(validAvatar('data:image/jpeg;base64,/9j/4AAQ'));
  assert.ok(!validAvatar('data:text/html;base64,PGh0bWw+'));
  assert.ok(!validAvatar(`data:image/jpeg;base64,${'A'.repeat(300_000)}`));
  assert.ok(!validAvatar(null));
});
