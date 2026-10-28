import { ledgerScale, levelPrice, type PurchaseShare } from "../../shared/compensation.ts";

// Receipt verification only: preserve accounting for already-signed version-1 purchases.
export function legacyPurchaseShares(level: number): PurchaseShare[] {
  const units = levelPrice(level) * ledgerScale, pool = BigInt(units) * 15n / 100n;
  const bonus = Array.from({ length: 15 }, (_, index) => {
    const numerator = pool * (1n << BigInt(14-index));
    return { kind: "bonus" as const,depth: index+1,units: Number(numerator/32767n),remainder: numerator%32767n };
  });
  const remaining = Number(pool)-bonus.reduce((sum,share) => sum+share.units,0);
  const order = [...bonus].sort((a,b) => a.remainder === b.remainder ? a.depth-b.depth : a.remainder > b.remainder ? -1 : 1);
  for (let i=0;i<remaining;i++) order[i]!.units++;
  return [...[50,20,10].map((percent,index) => ({ kind: "direct" as const,depth: index+1,units: units*percent/100 })),
    ...bonus.map(({ kind,depth,units }) => ({ kind,depth,units })),{ kind: "platform",depth: 0,units: units/20 }];
}

// Version-2 receipt verification remains unchanged after switching new purchases.
export function version2PurchaseShares(level: number): PurchaseShare[] {
  const units = levelPrice(level) * ledgerScale;
  return [...[50,20,10].map((percent,index) => ({ kind: "direct" as const, depth: index+1, units: units*percent/100 })),
    ...Array.from({ length: 15 }, (_,index) => ({ kind: "bonus" as const, depth: index+1, units: units/100 })),
    { kind: "platform", depth: 0, units: units/20 }];
}
export function version2RecipientDepth(share: PurchaseShare, addresses: string[]) {
  if (share.kind === "platform") return 0;
  const highest = addresses.findLastIndex(address => !/^0x0{40}$/i.test(address)) + 1;
  const depth = share.kind === "bonus" && share.depth > highest ? highest : share.depth;
  return depth && !/^0x0{40}$/i.test(addresses[depth-1]!) ? depth : 0;
}
