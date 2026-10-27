import { createError } from "h3";
import type { H3Event } from "h3";
import { walletLoginOrigin } from "../lib/wallet-challenge";
import { passwordLoginEnabled } from "../../shared/auth-mode";

export function walletAuthOrigin(event: H3Event) {
  try { return walletLoginOrigin(getRequestURL(event).origin,useRuntimeConfig().public.appUrl); }
  catch (error) {
    const mismatch = error instanceof Error && error.message === "origin";
    throw createError({ statusCode: mismatch ? 403 : 503,statusMessage: mismatch ? "Wallet sign-in must use the configured application origin." : "Set NUXT_PUBLIC_APP_URL to the application's canonical origin before enabling wallet sign-in." });
  }
}

export const externalWalletMode = () => useRuntimeConfig().public.walletMode !== "embedded";
export function requirePasswordLoginEnabled() {
  if (!passwordLoginEnabled(useRuntimeConfig().public.passwordLoginEnabled))
    throw createError({ statusCode: 403, statusMessage: "Member ID and password login is disabled. Sign in with your external wallet." });
}
export function requireEmbeddedWalletMode() {
  if (externalWalletMode()) throw createError({ statusCode: 403, statusMessage: "In-app wallets are disabled. Connect your wallet to sign this action." });
}
export function requireExternalWalletMode() {
  if (!externalWalletMode()) throw createError({ statusCode: 403, statusMessage: "Connected wallets are disabled in embedded wallet mode." });
}
