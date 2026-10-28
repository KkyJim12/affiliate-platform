import { processLedgerMatrixUpgrades } from "../utils/compensation";
import { db } from "../utils/database";
import { reconcilePendingChainOperations } from "../utils/referral-chain";
import { reconcilePendingEvmSends } from "../utils/evm-send";
import { reconcileExternalOperations } from "../utils/external-wallet";

export default defineNitroPlugin(nitro => {
  // Wait for database plugin migrations before the first pass. Pending signed
  // transactions survive restarts and do not require an unlocked wallet.
  const timer = setInterval(() => { void db().one("SELECT to_regclass('evm_sends') AS name")
    .then(row => row?.name ? Promise.allSettled([reconcilePendingChainOperations(), reconcilePendingEvmSends(), reconcileExternalOperations(), processLedgerMatrixUpgrades()]) : undefined).catch(() => {}); }, 15_000);
  timer.unref();
  nitro.hooks.hook("close", () => clearInterval(timer));
});
