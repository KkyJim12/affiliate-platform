export const referralContractAbi = [
  "function distributionVersion() view returns (uint256)",
  "function paidDirectReferrals(address) view returns (uint256)",
  "function paidReferrerOf(address) view returns (address)",
  "function commissionQualified(address) view returns (bool)",
  "function heldCommissions(address) view returns (uint256)",
  "function totalHeldCommissions() view returns (uint256)",
  "function qualifyCommission(address member,uint256 nonce,bytes signature)",
  "function rebirthVersion() view returns (uint256)",
  "function paymentToken() view returns (address)",
  "function tokenDecimals() view returns (uint8)",
  "function feeRecipient() view returns (address)",
  "function quoteSigner() view returns (address)",
  "function configNonce() view returns (uint256)",
  "function owner() view returns (address)",
  "function paused() view returns (bool)",
  "function levelOf(address) view returns (uint8)",
  "function purchased(bytes32) view returns (bool)",
  "function priceForLevel(uint8) view returns (uint256)",
  "function previewShares(uint8) view returns (uint256[19])",
  "function purchase((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline,bytes32 matrixCycle,address sponsor,uint256 qualifiedMask,bool sponsorExempt) quote,address[18] uplines,bytes signature)",
  "function autoUpgrade((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline,bytes32 matrixCycle,address sponsor,uint256 qualifiedMask,bool sponsorExempt) quote,address[18] uplines,bytes signature)",
  "function rebirth((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline,bytes32 matrixCycle,address sponsor,uint256 qualifiedMask,bool sponsorExempt) quote,address[18] uplines,bytes signature)",
  "function rebornCycles(bytes32) view returns (bool)",
  "function upgradedCycles(bytes32) view returns (bool)",
  "function setFeeRecipient(address)",
  "event SharePaid(bytes32 indexed id,uint8 kind,uint8 depth,address indexed recipient,uint256 amount,bool redirected)",
  "event ShareHeld(bytes32 indexed id,uint8 kind,uint8 depth,address indexed recipient,uint256 amount)",
  "event CommissionQualified(address indexed member)",
  "event HeldCommissionReleased(address indexed member,uint256 amount)",
  "event PurchaseCompleted(bytes32 indexed id,address indexed buyer,uint8 level,uint8 previousLevel,uint256 amount,address feeRecipient,bytes32 uplinesHash,uint256 configNonce)",
  "event FeeRecipientChanged(address indexed previousRecipient,address indexed recipient,uint256 configNonce)",
] as const;

export const purchaseTypes = { Purchase: [
  { name: "id", type: "bytes32" }, { name: "buyer", type: "address" },
  { name: "level", type: "uint8" }, { name: "previousLevel", type: "uint8" },
  { name: "uplinesHash", type: "bytes32" }, { name: "feeRecipient", type: "address" },
  { name: "configNonce", type: "uint256" }, { name: "deadline", type: "uint256" },
  { name: "matrixCycle", type: "bytes32" },
  { name: "sponsor", type: "address" }, { name: "qualifiedMask", type: "uint256" },
  { name: "sponsorExempt", type: "bool" },
] };
export const qualificationTypes = { Qualification:[{name:"member",type:"address"},{name:"configNonce",type:"uint256"}] };

export interface ChainPurchaseQuote {
  id: string; buyer: string; level: number; previousLevel: number;
  uplinesHash: string; feeRecipient: string; configNonce: string; deadline: number; matrixCycle: string;
  sponsor: string; qualifiedMask: number; sponsorExempt: boolean;
}

export interface ChainPurchaseStatus {
  id: string;
  kind?: "purchase" | "rebirth";
  level: number;
  status: "awaiting_signature" | "pending" | "confirmed" | "failed";
  transactionHash: string | null;
  explorerUrl: string | null;
}

export interface ReferralChainStatus {
  error?: string;
  mode: "contract" | "ledger";
  configured: boolean;
  ready: boolean;
  chainId: number;
  contractAddress: string | null;
  tokenAddress: string | null;
  tokenSymbol: string | null;
  feeRecipient: string | null;
  owner: string | null;
  balance: string | null;
  gasBalance: string | null;
  gasBudget: string | null;
  currentLevel: number | null;
  pending: ChainPurchaseStatus | null;
}
