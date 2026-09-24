const activeStatuses = new Set(['assigned']);
const reasons = new Set(['Vehicle not found', 'Vehicle details mismatch', 'Unsafe situation', 'Customer dispute', 'Authority issue', 'Other']);
const checklist = ['Battery', 'Spare tyre', 'Fuel level', 'Matting', 'Keys and key number', 'Meter / odometer', 'Existing damages', 'Self motor', 'Wiper / motor', 'Stereo / infotainment', 'Ignition coil', 'Speakers', 'Side mirrors', 'Tyre condition'];
const conditions = new Set(['Present / working', 'Missing', 'Damaged', 'Not applicable']);

export function validateFieldCase(recoveryCase) {
  return activeStatuses.has(recoveryCase.status) ? null : 'This case is no longer an active assignment.';
}

export function validateAttempt(recoveryCase, { reason, note }) {
  const statusError = validateFieldCase(recoveryCase);
  if (statusError) return statusError;
  if (!reasons.has(reason)) return 'Choose a valid attempt reason.';
  if (!String(note || '').trim() || String(note).length > 2000) return 'A factual field note up to 2,000 characters is required.';
  return null;
}

export function validateCustody(recoveryCase, { yardName, arrivalTime, parkingRate, checklist: completed, inspection, evidenceCount, customNote }) {
  const statusError = validateFieldCase(recoveryCase);
  if (statusError) return statusError;
  if (!String(yardName || '').trim() || String(yardName).length > 200) return 'Enter a valid parking location.';
  if (!arrivalTime || Number.isNaN(Date.parse(arrivalTime))) return 'Enter a valid vehicle arrival time.';
  if (!Number.isFinite(parkingRate) || parkingRate < 0 || parkingRate > 1_000_000) return 'Enter a valid daily parking rate.';
  if (completed !== checklist.length || !inspection || checklist.some((item) => !conditions.has(inspection[item]))) return 'Complete every known vehicle condition check.';
  if (evidenceCount < 1) return 'At least one photo or video evidence record is required before custody submission.';
  if (String(customNote || '').length > 2000) return 'Keep the custom note within 2,000 characters.';
  return null;
}

// Field submissions must carry a real GPS fix. Blank values would coerce to 0,0, so reject them explicitly.
export function readLocation(body) {
  const raw = [body?.latitude, body?.longitude];
  if (raw.some((value) => value === undefined || value === null || String(value).trim() === '')) return { error: 'Capture your GPS location before submitting.' };
  const [latitude, longitude] = raw.map(Number);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { error: 'The GPS location is invalid. Capture it again.' };
  return { latitude, longitude };
}
