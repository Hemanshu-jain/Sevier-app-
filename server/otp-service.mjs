const baseUrl = 'https://control.msg91.com/api/v5/otp';

export function normalizeIndiaMobile(value) {
  const digits = String(value || '').replace(/\D/g, '');
  const local = digits.startsWith('91') && digits.length === 12 ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(local)) throw new Error('Enter a valid Indian mobile number.');
  return `91${local}`;
}

export function createOtpService({ authKey, templateId, fetchImpl = fetch }) {
  if (!authKey || !templateId) throw new Error('MSG91 OTP is not configured.');

  async function providerRequest(url, options) {
    let response;
    try {
      response = await fetchImpl(url, options);
    } catch {
      throw new Error('OTP service is unavailable. Try again.');
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.type !== 'success') throw new Error(payload.message || 'OTP service rejected the request.');
    return payload;
  }

  return {
    async send(mobile) {
      const query = new URLSearchParams({
        template_id: templateId,
        mobile: normalizeIndiaMobile(mobile),
        authkey: authKey,
      });
      const payload = await providerRequest(`${baseUrl}?${query}`, { method: 'POST' });
      return { requestId: payload.request_id || null };
    },

    async verify(mobile, code) {
      if (!/^\d{4,8}$/.test(String(code || ''))) throw new Error('OTP must contain 4 to 8 digits.');
      const query = new URLSearchParams({ otp: String(code), mobile: normalizeIndiaMobile(mobile) });
      await providerRequest(`${baseUrl}/verify?${query}`, { method: 'GET', headers: { authkey: authKey } });
      return { verified: true };
    },
  };
}
