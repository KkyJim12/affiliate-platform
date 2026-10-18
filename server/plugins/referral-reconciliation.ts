import { db } from "../utils/database";
import { reconcilePendingChainOperations } from "../utils/referral-chain";

export default defineNitroPlugin(nitro => {
  // Wait for database plugin migrations before the first pass. Pending signed
  // transactions survive restarts and do not require an unlocked wallet.
  const timer = setInterval(() => { void db().one("SELECT to_regclass('referral_chain_purchases') AS name")
    .then(row => row?.name ? reconcilePendingChainOperations() : undefined).catch(() => {}); }, 15_000);
  timer.unref();
  nitro.hooks.hook("close", () => clearInterval(timer));
});
