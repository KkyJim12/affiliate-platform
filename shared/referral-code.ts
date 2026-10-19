export function normalizeReferralCode(code: string) {
  return code.trim().toUpperCase().replace(/^LOOP-/, "UNXO-");
}

export function isReferralCode(code: string) {
  return /^UNXO-[A-Z0-9]{8}$/.test(normalizeReferralCode(code));
}
