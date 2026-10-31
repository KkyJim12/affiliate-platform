import assert from 'node:assert/strict';
import { test } from 'node:test';
import { layoutReferralTree, treeChildPath, treeParentPath, treePathDepth } from '../shared/referral-tree.ts';
const member=(id,path,parentId)=>({id,path,parentId});
const fixture=(members=[],visibleDepth=3,path='')=>{const root=member('1','',null);return {root,path,visibleDepth,maxDepth:15,members:[root,...members],levels:[]};};
test('binary spillover retains two children at each slot and the correct parent',()=>{
 const tree=fixture([member('2','0','1'),member('3','1','1'),member('4','0/0','2'),member('5','0/1','2')]);
 const {nodes}=layoutReferralTree(tree,0,3000);
 for(const node of nodes.filter(n=>n.member)) assert.equal(nodes.find(p=>p.path===node.parent?.path)?.member?.id??null,node.member.parentId);
 assert.equal(nodes.filter(n=>n.depth===1).length,2);
 assert.equal(nodes.filter(n=>n.depth===2).length,4);
 assert.equal(nodes.length,15);
});
test('branch exploration and tree paths preserve depth',()=>{
 assert.equal(treePathDepth('1/0/1'),3);assert.equal(treeParentPath('1/0'),'1');assert.equal(treeChildPath('1',0),'1/0');
 const {nodes}=layoutReferralTree(fixture([member('2','0','1'),member('4','0/0','2')],2,'0'),0,2000);
 assert.equal(nodes[0].member.id,'2');assert.equal(nodes.find(n=>n.path==='0/0').parent.path,'0');
});
test('reborn member IDs remain separate nodes at each branch path',()=>{
 const tree=fixture([member('2','0','1'),member('2','1','1'),member('3','0/0','2'),member('4','1/0','2')]);
 const {nodes}=layoutReferralTree(tree,0,3000);
 assert.deepEqual(nodes.filter(n=>n.member?.id==='2').map(n=>n.path),['0','1']);
 assert.equal(nodes.find(n=>n.member?.id==='3').parent.path,'0');
 assert.equal(nodes.find(n=>n.member?.id==='4').parent.path,'1');
});
test('fifteen-step unilevel previews stay virtualized while matrix has four total rows',()=>{
 assert.equal(layoutReferralTree(fixture(),0,1000).nodes.length,15);
 const full=fixture([],15);const middle=layoutReferralTree(full,2_000_000,2_001_000);
 assert.ok(middle.nodes.length<250);
 const right=layoutReferralTree(full,middle.width-1000,middle.width);
 assert.ok(right.nodes.some(n=>n.path===Array(15).fill('1').join('/')));
 assert.equal(layoutReferralTree(fixture([],0,Array(15).fill('0').join('/')),0,1000).nodes.length,1);
});
