const signatures = {
  'application/pdf': Buffer.from('%PDF-'),
  'image/png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': Buffer.from([0xff, 0xd8, 0xff]),
};

export function isAllowedAuthorityDocument(buffer, mimeType) {
  const signature = signatures[mimeType];
  return Boolean(signature && buffer.subarray(0, signature.length).equals(signature));
}
