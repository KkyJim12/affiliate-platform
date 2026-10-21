export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase().replace(/^LOOP-/, "UNXO-");
}

export function isReferralCode(code: string) {
  const normalized = normalizeReferralCode(code);
  return isMemberId(normalized) || /^UNXO-[A-Z0-9]{8}$/.test(normalized);
}

export function isMemberId(value: string) {
  return /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
}
