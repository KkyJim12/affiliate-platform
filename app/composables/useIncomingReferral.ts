import { isReferralCode, normalizeReferralCode } from "#shared/referral-code";

export function useIncomingReferral() {
  const route = useRoute();
  function incomingReferral() {
    const query = typeof route.query.ref === "string" ? normalizeReferralCode(route.query.ref) : "";
    if (isReferralCode(query)) {
      if (import.meta.client) sessionStorage.setItem("loop-incoming-referral", query);
      return query;
    }
    const saved = import.meta.client ? sessionStorage.getItem("loop-incoming-referral") || "" : "";
    return isReferralCode(saved) ? normalizeReferralCode(saved) : "";
  }
  return { incomingReferral };
}
