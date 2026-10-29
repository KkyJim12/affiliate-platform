import type { createDatabase } from "./postgres.ts";
import { polygonNetwork } from "../../shared/evm-wallet.ts";

export async function bindDatabaseNetwork(database: ReturnType<typeof createDatabase>, chainId: number) {
  polygonNetwork(chainId);
  await database.transaction(async () => {
    await database.execute("SELECT pg_advisory_xact_lock(782438,4)");
    const existing = await database.one<{ chain_id: number }>("SELECT chain_id FROM platform_network");
    if (existing && existing.chain_id !== chainId)
      throw new Error("Use a separate database for Polygon mainnet and Amoy. Test purchases cannot become mainnet paid levels.");
    const evidence = await database.all<{ chain_id: number }>(`SELECT chain_id FROM evm_wallets UNION SELECT chain_id FROM connected_wallets
      UNION SELECT chain_id FROM evm_sends UNION SELECT chain_id FROM referral_chain_purchases
      UNION SELECT 80002 WHERE EXISTS(SELECT 1 FROM referral_purchases)
        OR EXISTS(SELECT 1 FROM referral_activations WHERE transaction_id IS NOT NULL)`);
    if (evidence.some(row => row.chain_id !== chainId)) throw new Error("Database contains activity from another network. Use a separate mainnet database.");
    await database.execute("INSERT INTO platform_network(chain_id) VALUES($1) ON CONFLICT(singleton) DO NOTHING",chainId);
  });
}
