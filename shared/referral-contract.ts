export const referralContractAbi = [
  "function distributionVersion() view returns (uint256)",
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
  "function purchase((bytes32 id,address buyer,uint8 level,uint8 previousLevel,bytes32 uplinesHash,address feeRecipient,uint256 configNonce,uint256 deadline) quote,address[15] uplines,bytes signature)",
  "function setFeeRecipient(address)",
  "event SharePaid(bytes32 indexed id,uint8 kind,uint8 depth,address indexed recipient,uint256 amount,bool redirected)",
  "event PurchaseCompleted(bytes32 indexed id,address indexed buyer,uint8 level,uint8 previousLevel,uint256 amount,address feeRecipient,bytes32 uplinesHash,uint256 configNonce)",
  "event FeeRecipientChanged(address indexed previousRecipient,address indexed recipient,uint256 configNonce)",
] as const;

export const purchaseTypes = { Purchase: [
  { name: "id", type: "bytes32" }, { name: "buyer", type: "address" },
  { name: "level", type: "uint8" }, { name: "previousLevel", type: "uint8" },
  { name: "uplinesHash", type: "bytes32" }, { name: "feeRecipient", type: "address" },
  { name: "configNonce", type: "uint256" }, { name: "deadline", type: "uint256" },
] };

export interface ChainPurchaseQuote {
  id: string; buyer: string; level: number; previousLevel: number;
  uplinesHash: string; feeRecipient: string; configNonce: string; deadline: number;
}

export interface ChainPurchaseStatus {
  id: string;
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
