export const binaryTreeDepth = 15;
export interface BinaryMember {
  id: string;
  username: string;
  path: string;
}
export interface BinaryReferralTree {
  root: BinaryMember;
  path: string;
  maxDepth: number;
  visibleDepth: number;
  members: BinaryMember[];
  levels: { depth: number; filled: number; capacity: number }[];
}
