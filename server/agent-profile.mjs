// Agent-only profile fields (address, ID proof, photo). Name, city and rates stay in PUT /api/profile.

const ID_FORMATS = { aadhaar: /^\d{12}$/, pan: /^[A-Z]{5}\d{4}[A-Z]$/ };
const AVATAR_PATTERN = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
export const AVATAR_MAX_LENGTH = 300_000; // ~220 KB image; the app sends a 256px JPEG (~30 KB)

// Returns { values } or { error }. `requireIdProof` is true until the agent has one on file.
export function parseAgentProfile(body, { requireIdProof }) {
  const addressLine1 = String(body?.addressLine1 ?? '').trim();
  const addressLine2 = String(body?.addressLine2 ?? '').trim();
  const pincode = String(body?.pincode ?? '').trim();
  const idProofType = String(body?.idProofType ?? '').trim();
  const idProof = String(body?.idProof ?? '').replace(/\s+/g, '').toUpperCase();
  if (addressLine1.length < 3 || addressLine1.length > 191) return { error: 'Enter your house / street address.' };
  if (addressLine2.length > 191) return { error: 'Area / landmark is too long.' };
  if (!/^\d{6}$/.test(pincode)) return { error: 'Enter a 6-digit pincode.' };
  if (!idProof) return requireIdProof ? { error: 'Add your Aadhaar or PAN number.' } : { values: { addressLine1, addressLine2, pincode, idProofType: null, idProof: '' } };
  if (!ID_FORMATS[idProofType]) return { error: 'Choose Aadhaar or PAN.' };
  if (!ID_FORMATS[idProofType].test(idProof)) return { error: idProofType === 'aadhaar' ? 'Aadhaar must be 12 digits.' : 'PAN must look like ABCDE1234F.' };
  return { values: { addressLine1, addressLine2, pincode, idProofType, idProof } };
}

export function validAvatar(value) {
  return typeof value === 'string' && value.length <= AVATAR_MAX_LENGTH && AVATAR_PATTERN.test(value);
}

export function agentProfile(row) {
  return {
    addressLine1: row.address_line1 ?? '', addressLine2: row.address_line2 ?? '', pincode: row.pincode ?? '',
    idProofType: row.id_proof_type ?? null, idProofLast4: row.id_proof ? String(row.id_proof).slice(-4) : null, avatar: row.avatar ?? null,
  };
}
