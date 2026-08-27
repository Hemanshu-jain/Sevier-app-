const signatures = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
};

export function isAllowedAuthorityDocument(buffer, mimeType) {
  const signature = signatures[mimeType];
  return Boolean(signature && buffer.subarray(0, signature.length).equals(signature));
}

export function isAllowedEvidenceFile(buffer, mimeType) {
  if (mimeType === 'image/jpeg' || mimeType === 'image/png') return isAllowedAuthorityDocument(buffer, mimeType);
  if (mimeType === 'image/webp') return buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP';
  if (mimeType === 'video/mp4') return buffer.subarray(4, 8).toString() === 'ftyp';
  if (mimeType === 'video/webm') return buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  return false;
}
