import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutReferralTree, treeChildPath, treeParentPath, treePathDepth } from '../shared/referral-tree.ts';

const member = (id, path, parentId) => ({ id, path, parentId, username: `member_${id}` });
function fixture(members = [], visibleDepth = 3, path = '') {
  const root = member('1', '', null);
  return { root, path, visibleDepth, maxDepth: 15, members: [root, ...members], levels: [] };
}

test('three direct referrals and three nested referrals retain their actual parents', () => {
  const tree = fixture([
    member('2', '0', '1'), member('3', '1', '1'), member('4', '2', '1'),
    member('5', '2/0', '4'), member('6', '2/1', '4'), member('7', '2/2', '4'),
  ]);
  const { nodes } = layoutReferralTree(tree, 0, 3000);
  const real = nodes.filter(node => node.member);
  for (const node of real) {
    const parent = nodes.find(candidate => candidate.path === node.parent?.path);
    assert.equal(parent?.member?.id ?? null, node.member.parentId);
  }
  const direct = real.filter(node => node.depth === 1);
  assert.deepEqual(direct.map(node => node.member.id), ['2', '3', '4']);
  assert.equal(new Set(direct.map(node => node.y)).size, 1);
  assert.equal(new Set(direct.map(node => node.x)).size, 3);
  assert.deepEqual(real.filter(node => node.depth === 2).map(node => node.parent.path), ['2', '2', '2']);
  for (const depth of [1, 2, 3]) {
    const row = nodes.filter(node => node.depth === depth).sort((a, b) => a.x - b.x);
    assert.ok(row.every((node, index) => !index || node.x - row[index - 1].x >= 152));
  }
});

test('multi-digit branch numbers are one level and retain siblings when explored', () => {
  const members = Array.from({ length: 12 }, (_, slot) => member(String(slot + 2), String(slot), '1'));
  members.push(member('20', '10/0', '12'), member('21', '10/1', '12'), member('22', '10/2', '12'));
  assert.equal(treePathDepth('10/2'), 2);
  assert.equal(treeParentPath('10/2'), '10');
  assert.equal(treeChildPath('10', 2), '10/2');
  const tree = fixture(members, 3, '10');
  const layout = layoutReferralTree(tree, 0, 2000);
  assert.deepEqual(layout.nodes.filter(node => node.member).map(node => node.member.id), ['12', '20', '21', '22']);
  assert.ok(layout.nodes.filter(node => node.depth === 2).every(node => node.parent.path === '10'));
});

test('empty mockup keeps two branches and 15-level previews remain virtualized', () => {
  const preview = layoutReferralTree(fixture(), 0, 1000);
  assert.equal(preview.nodes.length, 15);
  assert.equal(preview.nodes.filter(node => node.depth === 1).length, 2);
  const full = fixture([member('2', '0', '1'), member('3', '1', '1'), member('4', '2', '1')], 15);
  const middle = layoutReferralTree(full, 3_700_000, 3_701_000);
  assert.ok(middle.nodes.length < 250);
  const right = layoutReferralTree(full, middle.width - 1000, middle.width);
  assert.ok(right.nodes.length < 250);
  assert.ok(right.nodes.some(node => node.path === ['2', ...Array(14).fill('1')].join('/')));
  const last = fixture([], 0, Array(15).fill('0').join('/'));
  assert.equal(layoutReferralTree(last, 0, 1000).nodes.length, 1);
});

test('broad real networks keep 15-level views within browser scroll limits', () => {
  const members = Array.from({ length: 100 }, (_, slot) => member(String(slot + 2), String(slot), '1'));
  // Use a connected 15-level invitation chain in the last direct branch.
  let parentId = '101', path = '99';
  for (let depth = 2; depth <= 15; depth++) {
    path = treeChildPath(path, 0);
    const child = member(String(200 + depth), path, parentId);
    members.push(child);
    parentId = child.id;
  }
  const tree = fixture(members, 15);
  const initial = layoutReferralTree(tree, 0, 1000);
  assert.ok(initial.width < 16_000_000);
  const leaf = layoutReferralTree(tree, 0, initial.width).nodes.find(node => node.member?.id === '215');
  assert.equal(leaf.depth, 15);
  const scrolled = layoutReferralTree(tree, leaf.x - 500, leaf.x + 500);
  assert.ok(scrolled.nodes.some(node => node.member?.id === '215'));
  assert.ok(scrolled.nodes.length < 250);
});
