export function useWalletSummary() {
  const state = useEvmWallet();
  const { localeTag, t } = useLoopI18n();
  const asset = computed(() => {
    const balances = state.balances.value;
    if (!balances?.token || !/^(t)?usdt$/i.test(balances.token.symbol)) return null;
    if (state.wallet.value && balances.address.toLowerCase() !== state.wallet.value.address.toLowerCase()) return null;
    return balances.token;
  });
  const symbol = computed(() => asset.value?.symbol || "USDT");
  const formattedBalance = computed(() => {
    if (!asset.value) return "—";
    const [whole = "0", fraction = ""] = asset.value.balance.split(".");
    const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2)) + (Number(fraction[2] || "0") >= 5 ? 1n : 0n);
    const format = new Intl.NumberFormat(localeTag.value);
    const decimal = format.formatToParts(1.1).find(part => part.type === "decimal")?.value ?? ".";
    return format.format(cents / 100n) + decimal + String(cents % 100n).padStart(2, "0");
  });
  const balanceTitle = computed(() => state.balanceLoading.value ? t("profileMenu.loadingBalance")
    : asset.value ? `${asset.value.balance} ${symbol.value}` : t("profileMenu.balanceUnavailable"));
  return { ...state, formattedBalance, symbol, balanceTitle };
}
