import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedAuthorityDocument } from '../server/file-validation.mjs';

test('accepts PDF, PNG, and JPEG files only when bytes match the claimed type', () => {
  assert.equal(isAllowedAuthorityDocument(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(isAllowedAuthorityDocument(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png'), true);
  assert.equal(isAllowedAuthorityDocument(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(isAllowedAuthorityDocument(Buffer.from('plain text'), 'application/pdf'), false);
  assert.equal(isAllowedAuthorityDocument(Buffer.from('%PDF-1.7'), 'image/png'), false);
});
