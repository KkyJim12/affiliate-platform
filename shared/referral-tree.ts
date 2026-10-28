export const referralTreeDepth = 15;
export interface ReferralTreeMember {
  id: string;
  path: string;
  parentId: string | null;
}
export interface ReferralTreeData {
  root: ReferralTreeMember;
  path: string;
  maxDepth: number;
  visibleDepth: number;
  members: ReferralTreeMember[];
  levels: { depth: number; filled: number }[];
  mode?: "matrix" | "unilevel";
  programLevel?: number;
  cycle?: number;
  cycles?: number[];
}

export const treePathSlots = (path: string) => path ? path.split('/') : [];
export const treePathDepth = (path: string) => treePathSlots(path).length;
export const treeParentPath = (path: string) => treePathSlots(path).slice(0, -1).join('/');
export const treeChildPath = (path: string, slot: number) => path ? `${path}/${slot}` : String(slot);
export const referralTreeCard = { width: 132, height: 78, rowHeight: 120 };

interface PositionedReferral {
  path: string;
  depth: number;
  member: ReferralTreeMember | undefined;
  x: number;
  y: number;
  parent: { x: number; y: number; path: string } | null;
}

export function layoutReferralTree(tree: ReferralTreeData, left: number, right: number) {
  const byPath = new Map(tree.members.map(member => [member.path, member]));
  // Both programs have exactly two children per placement slot.
  const sizes = new Map<string, number>();
  let compactPreview = false;
  const childCount = (path: string) => compactPreview && !byPath.has(path) ? 0 : 2;
  function size(path: string, remaining: number): number {
    if (!remaining) return 1;
    if (sizes.has(path)) return sizes.get(path)!;
    const count = childCount(path);
    const units = !count ? 1 : !compactPreview ? 2 ** remaining
      : Array.from({ length: count }, (_, slot) => size(treeChildPath(path, slot), remaining - 1)).reduce((a, b) => a + b, 0);
    sizes.set(path, units);
    return units;
  }
  let units = size(tree.path, tree.visibleDepth);
  // Browsers cap scrollable dimensions. For very broad networks, keep all real
  // invitations and preview only the next empty positions instead of expanding
  // millions of hypothetical descendants.
  if (units * 152 > 16_000_000) {
    compactPreview = true;
    sizes.clear();
    units = size(tree.path, tree.visibleDepth);
  }
  const width = Math.max(800, units * 152 + 40);
  const unitWidth = (width - 40) / units;
  const nodes: PositionedReferral[] = [];
  function place(path: string, relativeDepth: number, start: number, parent: PositionedReferral['parent']) {
    const remaining = tree.visibleDepth - relativeDepth;
    const span = size(path, remaining) * unitWidth;
    // Keep small previews complete and virtualize wide trees at every depth.
    if (units > 64 && (start + span < left - referralTreeCard.width || start > right + referralTreeCard.width)) return;
    const node = { path, depth: treePathDepth(path), member: byPath.get(path),
      x: start + span / 2, y: 22 + relativeDepth * referralTreeCard.rowHeight, parent };
    nodes.push(node);
    if (!remaining) return;
    let cursor = start;
    for (let slot = 0; slot < childCount(path); slot++) {
      const childPath = treeChildPath(path, slot);
      place(childPath, relativeDepth + 1, cursor, { x: node.x, y: node.y, path });
      cursor += size(childPath, remaining - 1) * unitWidth;
    }
  }
  place(tree.path, 0, 20, null);
  return { nodes, width, height: 44 + tree.visibleDepth * referralTreeCard.rowHeight + referralTreeCard.height };
}
