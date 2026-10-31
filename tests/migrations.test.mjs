import { completeRebirth, rebirthRecipients, unlockMatrixLevel, referralRecipients } from "../server/utils/matrix.ts";
import { commissionAuthorization, paidReferralCount, reconcileHeldChainAllocations } from "../server/utils/commission-qualification.ts";
import { bindDatabaseNetwork } from "../server/lib/database-network.ts";
import { queuedReferralJobs, retryFailedReferralJobs } from "../server/utils/referral-auto-retry.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createDatabase } from "../server/lib/postgres.ts";
import { migrate, migrationStatus, prepareMigrations, readMigrations, resetDatabase } from "../server/lib/migrations.ts";
import { importSqlite } from "../scripts/lib/import-sqlite.mjs";

const sources = readMigrations();

test('automatic rebirth and upgrade retries recover failed purchases, respect cooldown and preserve unresolved payments',()=>isolated(async db=>{
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('retry-owner','retry-owner','hash','retry-owner',NULL,'2026-10-30')");
  await db.transaction(()=>unlockMatrixLevel('retry-owner',1,db));
  const slot='matrix:1:retry-owner:0',address=`0x${'12'.repeat(20)}`;
  for(const [index,kind,status] of [[0,'rebirth','failed'],[1,'upgrade','failed'],[2,'rebirth','pending'],[3,'upgrade','confirmed']]) {
    const purchase=`retry-purchase-${index}`,job=kind==='rebirth'?`rebirth:${index}`:slot;
    // Separate matrix and unilevel sources give both upgrade cases distinct IDs.
    const cycle=index===3?'unilevel:1:retry-owner':job;
    await db.execute(`INSERT INTO referral_chain_purchases
      (id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,signing_mode,created_at,updated_at)
      VALUES($1,'retry-owner',$1,$2,$3,80002,$4,$4,$4,$4,'{}',$5,'automatic','2026-10-30','2026-10-30')`,purchase,index+1,10_000_000*2**index,address,status);
    await db.execute(`INSERT INTO referral_auto_upgrades
      (cycle_id,user_id,level,source,source_level,slot_id,kind,rebirth_cycle,status,purchase_id,created_at)
      VALUES($1,'retry-owner',$2,$3,$4,$5,$6,$7,'pending',$8,'2026-10-30')`,
      cycle,kind==='rebirth'?1:2,index===3?'unilevel':'matrix',1,index===3?null:slot,kind,kind==='rebirth'?index+1:null,purchase);
  }
  await retryFailedReferralJobs(db);
  assert.deepEqual((await db.all("SELECT status,purchase_id FROM referral_auto_upgrades ORDER BY cycle_id")).map(row=>[row.status,row.purchase_id]),[
    ['queued',null],['queued',null],['pending','retry-purchase-2'],['pending','retry-purchase-3'],
  ]);
  assert.deepEqual(await queuedReferralJobs(db),[]);
  await db.execute("UPDATE referral_auto_upgrades SET last_attempt_at=(CURRENT_TIMESTAMP - INTERVAL '16 seconds')::TEXT WHERE status='queued'");
  assert.deepEqual((await queuedReferralJobs(db)).map(row=>row.kind).sort(),['rebirth','upgrade']);
  await retryFailedReferralJobs(db);
  assert.equal((await queuedReferralJobs(db)).length,2,'Recovery must not reset an existing retry delay');
  assert.ok((await db.all("SELECT last_error FROM referral_auto_upgrades WHERE status='queued'")).every(row=>row.last_error.includes('retry automatically')));
}));

test('commission qualification counts distinct paid sponsors rather than placements or repeated purchases',()=>isolated(async db=>{
  await migrate(db.pool,sources);
  for(const [member,sponsor] of [['qual-root',null],['qual-first','qual-root'],['qual-second','qual-root'],['qual-spill','qual-first']]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-30')",member,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${member}`,member);
  }
  const address=`0x${'12'.repeat(20)}`;
  await db.execute("INSERT INTO connected_wallets(user_id,address,chain_id,created_at) VALUES('qual-root',$1,80002,'2026-10-30')",address);
  const activate=async member=>{
    await db.execute("INSERT INTO wallet_transactions VALUES($1,$2,'referral_purchase',10000000,'completed','Activation',$1,'2026-10-30')",`t-${member}`,`w-${member}`);
    await db.execute("INSERT INTO referral_activations(user_id,transaction_id,created_at) VALUES($1,$2,'2026-10-30')",member,`t-${member}`);
  };
  assert.equal(await paidReferralCount('qual-root',db),0);
  await activate('qual-first');await activate('qual-spill');
  await db.execute("INSERT INTO referral_purchases(id,user_id,level,amount,transaction_id,fee_recipient_address,created_at) VALUES('held-test','qual-first',1,10000000,'t-qual-first',$1,'2026-10-30')",address);
  await db.execute("INSERT INTO referral_allocations(id,purchase_id,kind,depth,amount,recipient_user_id,status,reason) VALUES('held-allocation','held-test','direct',1,1000000,'qual-root','held','upline')");
  await assert.rejects(db.execute("UPDATE referral_allocations SET depth=4 WHERE id='held-allocation'"),{code:'23514'});
  assert.equal((await db.one("SELECT status FROM referral_allocations WHERE id='held-allocation'")).status,'held');
  assert.equal(await paidReferralCount('qual-root',db),1);
  assert.equal((await commissionAuthorization('qual-second',[{userId:'qual-root'}],'external',false,db)).qualifiedMask,0);
  const pending=await commissionAuthorization('qual-second',[{userId:'qual-root'}],'external',true,db);
  assert.equal(pending.sponsor,address);assert.equal(pending.qualifiedMask,1<<18);
  await activate('qual-second');
  assert.equal(await paidReferralCount('qual-root',db),2);
  assert.equal((await commissionAuthorization('qual-spill',[{userId:'qual-root'},{userId:'qual-first'}],'external',false,db)).qualifiedMask,1);
}));

test('held commission settlement tolerates out-of-order receipts and never releases a later hold or another contract',()=>isolated(async db=>{
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('held-member','held-member','hash','held-member',NULL,'2026-10-30')");
  const contract=`0x${'12'.repeat(20)}`,other=`0x${'34'.repeat(20)}`,recipient=`0x${'56'.repeat(20)}`;
  await db.execute("INSERT INTO referral_commission_releases VALUES($1,$2,10,100,$3,'3000000000000000000')",contract,`0x${'01'.repeat(32)}`,recipient);
  let level=0;
  for(const [id,block,index,target] of [['old',99,20,contract],['same',100,9,contract],['later',100,11,contract],['different',99,1,other]]) {
    await db.execute(`INSERT INTO referral_chain_purchases(id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,created_at,updated_at,block_number)
      VALUES($1,'held-member',$1,$2,$3,80002,$4,$4,$4,$4,'{}','confirmed','2026-10-30','2026-10-30',$5)`,id,++level,10000000*2**(level-1),target,block);
    await db.execute("INSERT INTO referral_chain_allocations(purchase_id,kind,depth,amount,recipient_address,recipient_user_id,reason,log_index,status) VALUES($1,'direct',1,$4,$2,'held-member','upline',$3,'held')",id,recipient,index,1000000*2**(level-1));
  }
  await reconcileHeldChainAllocations(db);await reconcileHeldChainAllocations(db);
  assert.deepEqual(await db.all('SELECT purchase_id,status FROM referral_chain_allocations ORDER BY purchase_id'),[
    {purchase_id:'different',status:'held'},{purchase_id:'later',status:'held'},{purchase_id:'old',status:'credited'},{purchase_id:'same',status:'credited'},
  ]);
}));
async function isolated(operation) {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && new URL(url).pathname.endsWith("_test"), "Use the isolated PostgreSQL test runner.");
  const admin = createDatabase(url);
  const schema = `unxo_${randomUUID().replaceAll("-", "")}`;
  const scoped = new URL(url);
  scoped.searchParams.set("options", `-c search_path=${schema}`);
  const database = createDatabase(scoped.toString());
  try {
    await admin.execute(`CREATE SCHEMA ${schema}`);
    return await operation(database, scoped.toString());
  } finally {
    await database.close();
    await admin.execute(`DROP SCHEMA ${schema} CASCADE`);
    await admin.close();
  }
}

test("mainnet databases bind to chain 137 and reject Amoy wallets and chain switches",()=>isolated(async db=>{
  await migrate(db.pool,sources);
  await bindDatabaseNetwork(db,137);await bindDatabaseNetwork(db,137);
  await assert.rejects(bindDatabaseNetwork(db,80002),/separate database/);
  await db.execute("INSERT INTO users VALUES('mainnet-user','mainnet-user','hash','mainnet-user',NULL,'2026-10-29')");
  await db.execute("INSERT INTO connected_wallets(user_id,address,chain_id,created_at) VALUES('mainnet-user',$1,137,'2026-10-29')",`0x${'12'.repeat(20)}`);
  await assert.rejects(db.execute("UPDATE connected_wallets SET chain_id=80002 WHERE user_id='mainnet-user'"),{code:'23514'});
  assert.equal((await db.one('SELECT chain_id FROM platform_network')).chain_id,137);
}));

test("rebirth charging migration preserves existing open slots and queued upgrades without retroactive debits",()=>isolated(async db=>{
  await migrate(db.pool,sources.filter(item=>item.name<'0018_'));
  await db.execute("INSERT INTO users VALUES('free-legacy','free-legacy','hash','free-legacy',NULL,'2026-10-29')");
  await db.transaction(()=>unlockMatrixLevel('free-legacy',1,db));
  for(let i=0;i<14;i++) {
    const member=`free-legacy-${i}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'free-legacy','2026-10-29')",member);
    await db.transaction(()=>unlockMatrixLevel(member,1,db));
  }
  const before=await db.all("SELECT id,unlocked,opened,completed_at,parent_id FROM matrix_slots ORDER BY id");
  await migrate(db.pool,sources);
  assert.deepEqual(await db.all("SELECT id,unlocked,opened,completed_at,parent_id FROM matrix_slots ORDER BY id"),before);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE kind='rebirth'")).count,0);
  assert.deepEqual(await db.one("SELECT level,kind,status FROM referral_auto_upgrades"),{level:2,kind:'upgrade',status:'queued'});
}));

test("each program's rebirth creates and pays distinct linked entries in both trees",()=>isolated(async db=>{
  await migrate(db.pool,sources);
  for(const member of ['route-root','route-left','route-right','route-buyer']) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-29')",member,member==='route-root'?null:'route-root');
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${member}`,member);
    await db.transaction(()=>unlockMatrixLevel(member,1,db));
  }
  const initial=await db.transaction(()=>referralRecipients('route-buyer',1,'ledger',db));
  assert.deepEqual(initial.slice(0,3).map(row=>row.userId),['route-left','route-root',null]);
  for(const program of ['matrix','unilevel']) {
    await db.execute(`UPDATE ${program}_slots SET completed_at='2026-10-29' WHERE user_id='route-root' AND level=1 AND cycle=0`);
    await db.execute("SELECT place_program_slot('route-root',1,$1,1)",program);
    // Imported already-paid sponsor cycle; the buyer's new cycle is still unpaid.
    await db.execute(`UPDATE ${program}_slots SET rebirth_paid=TRUE,unlocked=TRUE WHERE user_id='route-root' AND level=1 AND cycle=1`);
  }
  const original={};
  for(const program of ['matrix','unilevel']) original[program]=await db.one(`SELECT parent_id,branch FROM ${program}_slots WHERE user_id='route-buyer' AND level=1 AND cycle=0`);
  const jobs=[];
  for(const program of ['matrix','unilevel']) {
    await db.execute(`UPDATE ${program}_slots SET completed_at='2026-10-29' WHERE user_id='route-buyer' AND level=1 AND cycle=0`);
    const completion=program==='matrix'?'matrix:1:route-buyer:0':'unilevel:1:route-buyer';
    await db.execute("SELECT queue_referral_upgrade($1,'route-buyer',1,$2,$3)",completion,program,program==='matrix'?completion:null);
    const charge=await db.one("SELECT * FROM referral_auto_upgrades WHERE cycle_id=$1",`rebirth:${completion}`);
    jobs.push(charge);
    assert.equal(charge.rebirth_cycle,jobs.length,'Each completion gets fresh cycles, including when the other program completed first');
    const recipients=await db.transaction(()=>rebirthRecipients(charge,'ledger',db));
    assert.deepEqual(recipients.slice(0,3).map(row=>row.userId),['route-root',null,null]);
    assert.deepEqual(recipients.slice(3,6).map(row=>row.userId),['route-root',null,null]);
    await db.execute("SELECT queue_referral_upgrade($1,'route-buyer',1,$2,$3)",completion,program,program==='matrix'?completion:null);
    assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_rebirth_entries")).count,jobs.length,'Retries keep the same pair');
  }
  for(const program of ['matrix','unilevel']) {
    assert.deepEqual(await db.all(`SELECT cycle,opened,unlocked,rebirth_paid FROM ${program}_slots WHERE user_id='route-buyer' AND level=1 AND cycle>0 ORDER BY cycle`),[
      {cycle:1,opened:true,unlocked:false,rebirth_paid:false},{cycle:2,opened:true,unlocked:false,rebirth_paid:false},
    ]);
  }
  // Settling one payment opens both of its entries, without paying the next pair.
  await db.transaction(()=>completeRebirth(jobs[0],db));
  await db.transaction(()=>completeRebirth(jobs[0],db));
  for(const program of ['matrix','unilevel']) {
    assert.deepEqual(await db.all(`SELECT cycle,unlocked,rebirth_paid FROM ${program}_slots WHERE user_id='route-buyer' AND level=1 AND cycle>0 ORDER BY cycle`),[
      {cycle:1,unlocked:true,rebirth_paid:true},{cycle:2,unlocked:false,rebirth_paid:false},
    ]);
  }
  await db.transaction(()=>completeRebirth(jobs[1],db));
  for(const program of ['matrix','unilevel']) {
    assert.deepEqual(await db.one(`SELECT parent_id,branch FROM ${program}_slots WHERE user_id='route-buyer' AND level=1 AND cycle=0`),original[program]);
    assert.equal((await db.one(`SELECT COUNT(*) AS count FROM ${program}_slots WHERE user_id='route-buyer' AND level=1 AND rebirth_paid AND unlocked`)).count,2);
  }
}));

test('linked rebirth entries keep separate cycle numbers and never reuse an existing paid position',()=>isolated(async db=>{
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('pair-cycles','pair-cycles','hash','pair-cycles',NULL,'2026-10-31')");
  await db.transaction(()=>unlockMatrixLevel('pair-cycles',1,db));
  await db.execute("UPDATE matrix_slots SET completed_at='2026-10-31' WHERE user_id='pair-cycles' AND level=1 AND cycle=0");
  await db.execute("SELECT place_program_slot('pair-cycles',1,'matrix',1)");
  await db.execute("UPDATE matrix_slots SET rebirth_paid=TRUE,unlocked=TRUE WHERE user_id='pair-cycles' AND level=1 AND cycle=1");
  const completion='unilevel:1:pair-cycles';
  await db.execute("UPDATE unilevel_slots SET completed_at='2026-10-31' WHERE user_id='pair-cycles' AND level=1 AND cycle=0");
  await db.execute("SELECT queue_referral_upgrade($1,'pair-cycles',1,'unilevel')",completion);
  assert.deepEqual(await db.one('SELECT matrix_slot_id,unilevel_slot_id FROM referral_rebirth_entries WHERE rebirth_id=$1',`rebirth:${completion}`),
    {matrix_slot_id:'matrix:1:pair-cycles:2',unilevel_slot_id:'unilevel:1:pair-cycles:1'});
  assert.deepEqual(await db.one("SELECT unlocked,rebirth_paid FROM matrix_slots WHERE id='matrix:1:pair-cycles:1'"),{unlocked:true,rebirth_paid:true});
  const job=await db.one('SELECT * FROM referral_auto_upgrades WHERE cycle_id=$1',`rebirth:${completion}`);
  await db.transaction(()=>completeRebirth(job,db));
  for(const [program,cycle] of [['matrix',2],['unilevel',1]]) assert.deepEqual(await db.one(`SELECT unlocked,rebirth_paid FROM ${program}_slots WHERE user_id='pair-cycles' AND level=1 AND cycle=$1`,cycle),{unlocked:true,rebirth_paid:true});
}));

test('linked rebirths follow the original paid inviter at higher levels and remain roots without an inviter',()=>isolated(async db=>{
  await migrate(db.pool,sources);
  for(const [member,sponsor] of [['pair-root',null],['pair-unpaid','pair-root'],['pair-owner','pair-unpaid'],['pair-alone',null]]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-31')",member,sponsor);
    if(member!=='pair-unpaid') await db.transaction(()=>unlockMatrixLevel(member,2,db));
  }
  for(const [member,program] of [['pair-owner','matrix'],['pair-alone','unilevel']]) {
    const completion=program==='matrix'?`matrix:2:${member}:0`:`unilevel:2:${member}`;
    await db.execute(`UPDATE ${program}_slots SET completed_at='2026-10-31' WHERE user_id=$1 AND level=2 AND cycle=0`,member);
    await db.transaction(()=>db.execute('SELECT queue_referral_upgrade($1,$2,2,$3,$4)',completion,member,program,program==='matrix'?completion:null));
    for(const target of ['matrix','unilevel']) {
      assert.deepEqual(await db.one(`SELECT parent_id,opened,unlocked FROM ${target}_slots WHERE user_id=$1 AND level=2 AND cycle=1`,member),
        {parent_id:member==='pair-alone'?null:`${target}:2:pair-root:0`,opened:true,unlocked:false});
    }
  }
}));

test('linked rebirth migration preserves routing and settlement of outstanding legacy quotes',()=>isolated(async db=>{
  await migrate(db.pool,sources.filter(item=>item.name<'0021_'));
  for(const [member,sponsor] of [['old-pair-root',null],['old-pair-owner','old-pair-root']]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-31')",member,sponsor);
    await db.execute('INSERT INTO wallets(id,user_id) VALUES($1,$2)',`w-${member}`,member);
    await db.transaction(()=>unlockMatrixLevel(member,1,db));
  }
  const completion='matrix:1:old-pair-owner:0';
  await db.execute("UPDATE matrix_slots SET completed_at='2026-10-31' WHERE id=$1",completion);
  await db.execute("SELECT queue_referral_upgrade($1,'old-pair-owner',1,'matrix',$1)",completion);
  await db.execute("SELECT place_program_slot('old-pair-owner',1,'matrix',1)");
  await migrate(db.pool,sources);
  const job=await db.one('SELECT * FROM referral_auto_upgrades WHERE cycle_id=$1',`rebirth:${completion}`);
  const recipients=await db.transaction(()=>rebirthRecipients(job,'ledger',db));
  assert.equal(recipients[0].userId,'old-pair-root');assert.equal(recipients[3].userId,'old-pair-root');
  await db.transaction(()=>completeRebirth(job,db));
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='old-pair-owner' AND level=1 AND cycle=1")).unlocked,true);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM unilevel_slots WHERE user_id='old-pair-owner' AND level=1 AND cycle>0")).count,0);
}));

test("existing Amoy paid databases cannot be reopened as mainnet databases",()=>isolated(async db=>{
  await migrate(db.pool,sources.filter(item=>item.name<'0017_'));
  await db.execute("INSERT INTO users VALUES('amoy-user','amoy-user','hash','amoy-user',NULL,'2026-10-29')");
  await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE user_id='amoy-user' AND level=1");
  await migrate(db.pool,sources);
  await assert.rejects(bindDatabaseNetwork(db,137),/separate database/);
  await bindDatabaseNetwork(db,80002);
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='amoy-user' AND level=1")).unlocked,true);
}));

test("PostgreSQL migrations are idempotent and enforce exact money, ownership and case-insensitive uniqueness", () => isolated(async db => {
  assert.deepEqual(await migrate(db.pool, sources), sources.map(item => item.name));
  assert.deepEqual(await migrate(db.pool, sources), []);
  assert.ok((await migrationStatus(db.pool, sources)).every(item => item.status === "applied"));
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 999999999000000)");
  assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 999999999000000);
  assert.equal((await db.one("SELECT SUM(available) AS total FROM wallets")).total, 999999999000000);
  await assert.rejects(db.execute("UPDATE wallets SET available = -1 WHERE id = 'w'"), { code: "23514" });
  await assert.rejects(db.execute("UPDATE wallets SET available = 9007199254740992 WHERE id = 'w'"), { code: "23514" });
  await assert.rejects(db.execute("INSERT INTO wallets (id, user_id) VALUES ('orphan', 'missing')"), { code: "23503" });
  await assert.rejects(db.execute("INSERT INTO users VALUES ('duplicate', 'MEMBER', 'hash', 'UNASSIGNED-duplicate', NULL, '2026-10-18')"), { code: "23505" });
}));

test("existing referral codes migrate to UNXO while preserving suffixes and sponsor relationships", () => isolated(async db => {
  const unxoSources = sources.filter(item => item.name < "0010_");
  const previous = sources.filter(item => item.name < "0009_unxo_referral_codes.sql");
  await migrate(db.pool, previous);
  await db.execute(`INSERT INTO users VALUES
    ('sponsor', 'sponsor', 'hash', 'LOOP-1234ABCD', NULL, '2026-10-18'),
    ('member', 'member', 'hash', 'UNASSIGNED-member', 'sponsor', '2026-10-18'),
    ('current', 'current', 'hash', 'UNXO-ABCDEF12', NULL, '2026-10-18')`);
  assert.deepEqual(await migrate(db.pool, unxoSources), unxoSources.filter(source => source.name >= "0009_").map(source => source.name));
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'sponsor'")).referral_code, "UNXO-1234ABCD");
  assert.deepEqual(await db.one("SELECT referral_code, sponsor_id FROM users WHERE id = 'member'"), { referral_code: "UNASSIGNED-member", sponsor_id: "sponsor" });
  assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'current'")).referral_code, "UNXO-ABCDEF12");
  assert.deepEqual(await migrate(db.pool, unxoSources), []);
}));

test("numeric referral migration preserves accounts and legacy invites, and allocates consecutive IDs transactionally", () => isolated(async db => {
  await migrate(db.pool, sources.filter(item => item.name < "0012_"));
  await db.execute(`INSERT INTO users VALUES
    ('a', 'first', 'hash', 'UNXO-1234ABCD', NULL, '2026-10-17'),
    ('b', 'second', 'hash', 'UNASSIGNED-b', 'a', '2026-10-18')`);
  await migrate(db.pool, sources);
  assert.deepEqual(await db.all("SELECT id, referral_code, sponsor_id FROM users ORDER BY referral_code::BIGINT"), [
    { id: 'a', referral_code: '1', sponsor_id: null }, { id: 'b', referral_code: '2', sponsor_id: 'a' },
  ]);
  assert.equal((await db.one("SELECT user_id FROM referral_code_aliases WHERE code = 'UNXO-1234ABCD'")).user_id, 'a');
  await assert.rejects(db.transaction(async () => {
    await db.execute("INSERT INTO users VALUES ('failed', 'failed', 'hash', 'UNASSIGNED-failed', NULL, '2026-10-19')");
    throw new Error('rollback registration');
  }), /rollback registration/);
  await Promise.all(Array.from({ length: 12 }, (_, i) => db.execute(
    "INSERT INTO users VALUES ($1,$1,'hash',$1,NULL,'2026-10-19')", `concurrent_${i}`)));
  assert.deepEqual((await db.all("SELECT referral_code::INTEGER AS id FROM users ORDER BY id")).map(row => row.id), Array.from({ length: 14 }, (_, i) => i + 1));
  assert.equal((await db.one("SELECT last_id FROM referral_id_counter")).last_id, 14);
  assert.equal(await db.one("SELECT id FROM users WHERE id = 'failed'"), undefined);
}));

test("binary placements fill breadth first with two slots, survive rollback and attach existing branches without cycles", () => isolated(async db => {
  await migrate(db.pool, sources);
  const insert = (id, sponsor = null) => db.execute("INSERT INTO users VALUES ($1,$1,'hash',$1,$2,'2026-10-19')", id, sponsor);
  await insert('root');
  await Promise.all(['a', 'b', 'c', 'd', 'e', 'f'].map(id => insert(id, 'root')));
  const placements = await db.all(`SELECT p.parent_id, p.slot, u.referral_code::INTEGER AS member FROM referral_placements p
    JOIN users u ON u.id = p.user_id ORDER BY member`);
  const byNumber = await db.all("SELECT id FROM users ORDER BY referral_code::BIGINT");
  assert.deepEqual(placements.map(row => [row.parent_id, row.slot]), [
    ['root', 0], ['root', 1], [byNumber[1].id, 0], [byNumber[1].id, 1], [byNumber[2].id, 0], [byNumber[2].id, 1],
  ]);
  await insert('late_root');
  await db.execute("UPDATE users SET sponsor_id = 'late_root' WHERE id = 'root'");
  assert.deepEqual(await db.one("SELECT parent_id, slot FROM referral_placements WHERE user_id = 'root'"), { parent_id: 'late_root', slot: 0 });
  await assert.rejects(db.execute("UPDATE users SET sponsor_id = 'a' WHERE id = 'late_root'"), { code: '23514' });
  assert.equal((await db.one("SELECT sponsor_id FROM users WHERE id = 'late_root'")).sponsor_id, null);
  await assert.rejects(db.transaction(async () => { await insert('rollback', 'root'); throw new Error('rollback'); }), /rollback/);
  assert.equal(await db.one("SELECT user_id FROM referral_placements WHERE user_id = 'rollback'"), undefined);
}));

test("Amoy wallet schema enforces owner, address, key encryption and network constraints", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18'), ('v', 'other', 'hash', 'UNASSIGNED-v', NULL, '2026-10-18')");
  const address = `0x${"ab".repeat(20)}`;
  const publicKey = `0x04${"1".repeat(128)}`;
  const encrypted = JSON.stringify({ version: 3, Crypto: { ciphertext: "2".repeat(64) } });
  const insert = (user, walletAddress, network, keystore = encrypted) => db.execute(
    "INSERT INTO evm_wallets VALUES ($1, $2, $3, $4, $5, '2026-10-18')", user, walletAddress, publicKey, keystore, network);
  await insert('u', address, 80002);
  assert.equal((await db.one("SELECT chain_id FROM evm_wallets WHERE user_id = 'u'")).chain_id, 80002);
  await assert.rejects(insert('missing', `0x${"3".repeat(40)}`, 80002), { code: "23503" });
  await assert.rejects(insert('u', `0x${"3".repeat(40)}`, 80002), { code: "23505" });
  await assert.rejects(insert('v', address.toUpperCase().replace('0X', '0x'), 80002), { code: "23505" });
  await assert.rejects(insert('v', `0x${"3".repeat(40)}`, 1), { code: "23514" });
  await assert.rejects(insert('v', 'LW-internal-wallet', 80002), { code: "23514" });
  await assert.rejects(insert('v', `0x${"3".repeat(40)}`, 80002, '{}'), { code: "23514" });
  await assert.rejects(db.transaction(async () => {
    await db.execute("INSERT INTO users VALUES ('rollback', 'rollback', 'hash', 'UNASSIGNED-rollback', NULL, '2026-10-18')");
    await insert('rollback', address, 80002);
  }), { code: "23505" });
  assert.equal(await db.one("SELECT id FROM users WHERE id = 'rollback'"), undefined);
}));

test("failed PostgreSQL migration batches roll back both schema and history", () => isolated(async db => {
  await migrate(db.pool, sources);
  const broken = prepareMigrations([{ name: "9999_failure.sql", sql: "CREATE TABLE should_rollback (id TEXT); INSERT INTO nonexistent VALUES (1);" }]);
  await assert.rejects(migrate(db.pool, [...sources, ...broken]), /9999_failure.sql/);
  assert.equal((await db.one("SELECT to_regclass('should_rollback') AS name")).name, null);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.deepEqual(await migrate(db.pool, sources), []);
}));

test("reset CLI requires exact confirmation and recreates only the selected schema with fresh migrations", () => isolated(async (db, url) => {
  await migrate(db.pool, sources);
  const defaults = await db.one("SELECT * FROM platform_settings WHERE id = 1");
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await db.execute("UPDATE platform_settings SET registration_open = 0, support_email = 'old@example.com'");
  await db.execute("CREATE TABLE obsolete_reset_fixture (id TEXT)");
  const schema = (await db.one("SELECT current_schema() AS name")).name;
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const run = (args, connectionString = url) => new Promise((done, reject) => {
    const child = spawn(process.execPath, ["scripts/reset-database.mjs", ...args], {
      env: { ...process.env, DATABASE_URL: connectionString }, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.once("error", reject);
    child.once("exit", code => done({ code, output }));
  });
  const help = await run(["--help"], "not-a-database-url");
  assert.equal(help.code, 0); assert.match(help.output, /Usage:/);
  for (const args of [[], ["--confirm", `${name}_wrong`], ["--confirm"], ["--yes"]]) {
    const refused = await run(args);
    assert.equal(refused.code, 1);
    assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 100);
  }
  const reset = await run(["--confirm", name]);
  assert.equal(reset.code, 0, reset.output);
  assert.match(reset.output, /Reset complete/);
  assert.ok(reset.output.includes(`schema ${JSON.stringify(schema)}`));
  const password = decodeURIComponent(new URL(url).password);
  if (password) assert.ok(!reset.output.includes(password), "Reset output must not reveal the database password.");
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM users")).count, 0);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM wallets")).count, 0);
  assert.equal((await db.one("SELECT to_regclass('obsolete_reset_fixture') AS name")).name, null);
  assert.deepEqual(await db.one("SELECT * FROM platform_settings WHERE id = 1"), defaults);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.ok((await migrationStatus(db.pool, sources)).every(item => item.status === "applied"));
}));

test("a failed reset migration restores the original data, schema and migration history", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await db.execute("CREATE TABLE preserved_reset_fixture (id TEXT)");
  await db.execute("INSERT INTO preserved_reset_fixture VALUES ('original')");
  const schema = (await db.one("SELECT current_schema() AS name")).name;
  const before = await db.all("SELECT * FROM schema_migrations ORDER BY name");
  const broken = prepareMigrations([{ name: "9999_reset_failure.sql", sql: "INSERT INTO nonexistent VALUES (1);" }]);
  await assert.rejects(resetDatabase(db.pool, [...sources, ...broken], schema), /9999_reset_failure.sql/);
  assert.equal((await db.one("SELECT available FROM wallets WHERE id = 'w'")).available, 100);
  assert.equal((await db.one("SELECT id FROM preserved_reset_fixture")).id, "original");
  assert.deepEqual(await db.all("SELECT * FROM schema_migrations ORDER BY name"), before);
}));

test("history validation rejects changed and missing files and normalizes Windows line endings", () => isolated(async db => {
  await migrate(db.pool, sources);
  const changed = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql + (item === sources[0] ? "\n-- Changed" : "") })));
  await assert.rejects(migrate(db.pool, changed), /Applied migration was changed/);
  await assert.rejects(migrate(db.pool, sources.slice(1)), /history does not match/);
  assert.throws(() => prepareMigrations([{ name: "0001_a.sql", sql: "SELECT 1;" }, { name: "0001_b.sql", sql: "SELECT 2;" }]), /duplicate/);
  const windows = prepareMigrations(sources.map(item => ({ name: item.name, sql: item.sql.replace(/\n/g, "\r\n") })));
  assert.deepEqual(await migrate(db.pool, windows), []);
}));

test("concurrent CLI migrations use an advisory lock and status never creates application tables", () => isolated(async (db, url) => {
  const run = command => new Promise((done, reject) => {
    const child = spawn(process.execPath, ["scripts/database.mjs", command], { env: { ...process.env, DATABASE_URL: url }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", data => { output += data; });
    child.stderr.on("data", data => { output += data; });
    child.once("error", reject);
    child.once("exit", code => code === 0 ? done(output) : reject(new Error(output)));
  });
  assert.match(await run("status"), /pending/);
  assert.equal((await db.one("SELECT to_regclass('schema_migrations') AS name")).name, null);
  await Promise.all([run("migrate"), run("migrate")]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM schema_migrations")).count, sources.length);
  assert.match(await run("status"), /applied/);
}));

test("async transactions keep one connection, roll back failures and serialize competing wallet debits", () => isolated(async db => {
  await migrate(db.pool, sources);
  await db.execute("INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', NULL, '2026-10-18')");
  await db.execute("INSERT INTO wallets (id, user_id, available) VALUES ('w', 'u', 100)");
  await assert.rejects(db.transaction(async () => { await db.execute("UPDATE wallets SET available = 0"); throw new Error("Abort"); }), /Abort/);
  assert.equal((await db.one("SELECT available FROM wallets")).available, 100);
  const debit = () => db.transaction(async () => {
    const wallet = await db.one("SELECT available FROM wallets WHERE id = 'w' FOR UPDATE");
    if (wallet.available < 60) throw new Error("Insufficient funds");
    await db.execute("UPDATE wallets SET available = available - 60 WHERE id = 'w'");
  });
  const results = await Promise.allSettled([debit(), debit()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal((await db.one("SELECT available FROM wallets")).available, 40);
}));

test("SQLite import preserves accounts, sponsors, balances, sessions, ledger, settings and reviews without modifying source", () => isolated(async db => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "unxo-import-"));
  const path = join(directory, "legacy.sqlite");
  const source = new DatabaseSync(path);
  try {
    source.exec(`
      CREATE TABLE users (id, username, password_hash, referral_code, sponsor_id, created_at);
      CREATE TABLE wallets (id, user_id, available, reserved);
      CREATE TABLE sessions (token_hash, user_id, expires_at);
      CREATE TABLE wallet_transactions (id, wallet_id, type, amount, status, description, request_key, created_at);
      CREATE TABLE user_access (user_id, role, status);
      CREATE TABLE payment_reviews (transaction_id, decision, reference, note, admin_id, created_at);
      CREATE TABLE referral_activations (user_id, transaction_id, created_at);
      CREATE TABLE platform_settings (id, registration_open, funding_open, support_email);
      INSERT INTO users VALUES ('member', 'member', 'original-member-hash', 'UNASSIGNED-member', 'admin', '2026-10-18');
      INSERT INTO users VALUES ('admin', 'admin', 'original-admin-hash', 'LOOP-1234ABCD', NULL, '2026-10-18');
      INSERT INTO wallets VALUES ('w', 'member', 25000000, 3000000);
      INSERT INTO sessions VALUES ('original-token-hash', 'member', 9999999999999);
      INSERT INTO wallet_transactions VALUES ('t', 'w', 'referral_purchase', 10000000, 'completed', 'Referral activation', 'original-request-key', '2026-10-18');
      INSERT INTO user_access VALUES ('admin', 'admin', 'active');
      INSERT INTO referral_activations (user_id, transaction_id, created_at) VALUES ('admin', 't', '2026-10-18');
      INSERT INTO payment_reviews VALUES ('t', 'approved', 'Original-Reference', 'Preserved note', 'admin', '2026-10-18');
      INSERT INTO platform_settings VALUES (1, 0, 0, 'existing@example.com');
    `);
    source.close();
    const before = readFileSync(path);
    await migrate(db.pool, sources);
    const counts = await importSqlite(path, db);
    assert.equal(counts.users, 2);
    assert.equal((await db.one("SELECT referral_code FROM users WHERE id = 'admin'")).referral_code, "2");
    assert.equal((await db.one("SELECT user_id FROM referral_code_aliases WHERE code = 'UNXO-1234ABCD'")).user_id, "admin");
    assert.deepEqual(await db.one("SELECT sponsor_id, password_hash FROM users WHERE id = 'member'"), { sponsor_id: "admin", password_hash: "original-member-hash" });
    assert.deepEqual(await db.one("SELECT available, reserved FROM wallets WHERE id = 'w'"), { available: 25000000, reserved: 3000000 });
    assert.equal((await db.one("SELECT token_hash FROM sessions")).token_hash, "original-token-hash");
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM schema_migrations")).total, sources.length);
    assert.equal((await db.one("SELECT support_email FROM platform_settings")).support_email, "existing@example.com");
    assert.equal((await db.one("SELECT note FROM payment_reviews")).note, "Preserved note");
    await assert.rejects(importSqlite(path, db), /empty PostgreSQL destination/);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM users")).total, 2);
    assert.deepEqual(readFileSync(path), before);
  } finally {
    try { source.close(); } catch {}
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("unxo-import-"));
    rmSync(directory, { recursive: true, force: true });
  }
}));

test("invalid SQLite relationships roll back the entire PostgreSQL import", () => isolated(async db => {
  const { DatabaseSync } = await import("node:sqlite");
  const directory = mkdtempSync(join(tmpdir(), "unxo-import-"));
  const path = join(directory, "invalid.sqlite");
  const source = new DatabaseSync(path);
  try {
    source.exec(`
      CREATE TABLE users (id, username, password_hash, referral_code, sponsor_id, created_at);
      CREATE TABLE wallets (id, user_id, available, reserved);
      CREATE TABLE sessions (token_hash, user_id, expires_at);
      CREATE TABLE wallet_transactions (id, wallet_id, type, amount, status, description, request_key, created_at);
      INSERT INTO users VALUES ('u', 'member', 'hash', 'UNASSIGNED-u', 'missing-sponsor', '2026-10-18');
      INSERT INTO wallets VALUES ('w', 'u', 10000000, 0);
    `);
    source.close();
    await migrate(db.pool, sources);
    await assert.rejects(importSqlite(path, db), { code: "23503" });
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM users")).total, 0);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM wallets")).total, 0);
    assert.equal((await db.one("SELECT COUNT(*) AS total FROM schema_migrations")).total, sources.length);
  } finally {
    try { source.close(); } catch {}
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("unxo-import-"));
    rmSync(directory, { recursive: true, force: true });
  }
}));

test("matrix slots limit each cycle to three descendant rows, recycle once and queue wallet-funded upgrades", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES ('root','matrix_root','hash','UNASSIGNED-root',NULL,'2026-10-28')");
  await db.execute("INSERT INTO wallets(id,user_id,available) VALUES('w-root','root',100000000)");
  for(let i=1;i<=16;i++) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'root',$2)",`child${i}`,`2026-10-28T00:00:${String(i).padStart(2,'0')}Z`);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-child${i}`,`child${i}`);
  }
  const matrix=await db.all(`WITH RECURSIVE positions AS (
    SELECT id,0 AS depth FROM matrix_slots WHERE user_id='root' AND level=1 AND cycle=0
    UNION ALL SELECT s.id,p.depth+1 FROM positions p JOIN matrix_slots s ON s.parent_id=p.id
  ) SELECT depth,COUNT(*) AS count FROM positions GROUP BY depth ORDER BY depth`);
  assert.deepEqual(matrix,[{depth:0,count:1},{depth:1,count:2},{depth:2,count:4},{depth:3,count:8}]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='root' AND level=1")).count,2);
  assert.equal((await db.one("SELECT parent_id FROM referral_placements WHERE user_id='child15'")).parent_id,'child7');
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE parent_id IS NOT NULL GROUP BY parent_id HAVING COUNT(*)>2 LIMIT 1")),undefined);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades")).count,0);
  await db.transaction(()=>unlockMatrixLevel('root',1,db));
  // A reserved cycle has not paid its rebirth charge and cannot earn commissions.
  assert.equal((await referralRecipients('child15',1,'ledger',db))[0].reason,'ineligible_upline');
  for(let i=1;i<=13;i++) await db.transaction(()=>unlockMatrixLevel(`child${i}`,1,db));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades WHERE user_id='root'")).count,0);
  await db.transaction(()=>unlockMatrixLevel('child14',1,db));
  await db.transaction(()=>unlockMatrixLevel('child14',1,db));
  assert.deepEqual(await db.all("SELECT user_id,level,status FROM matrix_auto_upgrades WHERE user_id='root'"),[{user_id:'root',level:2,status:'queued'}]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='root' AND level=1")).count,2);
  assert.ok((await db.one("SELECT completed_at FROM matrix_slots WHERE user_id='root' AND level=1 AND cycle=0")).completed_at);
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='root' AND level=2 AND cycle=0")).unlocked,false);
  const recipients=await referralRecipients('child3',1,'ledger',db);
  assert.equal(recipients.length,18);
  assert.equal(recipients[0].userId,'child1'); assert.equal(recipients[1].userId,'root');
  assert.equal(recipients[3].userId,'child1'); assert.equal(recipients[4].userId,'root');
  const locked=await referralRecipients('child3',2,'ledger',db);
  assert.ok(locked.every(item=>item.userId===null));
  await db.transaction(()=>unlockMatrixLevel('root',2,db));
  // An existing parentless reservation stays stable; a new entry sees the upgrade.
  assert.deepEqual(await referralRecipients('child3',2,'ledger',db),locked);
  const qualified=await referralRecipients('child4',2,'ledger',db);
  assert.equal(qualified[0].userId,'root'); assert.equal(qualified[1].reason,'missing_upline');
  assert.equal(qualified[3].userId,'root'); assert.equal(qualified[4].reason,'missing_upline');
  await db.execute("INSERT INTO user_access VALUES('root','member','suspended')");
  assert.equal((await referralRecipients('child4',2,'ledger',db))[0].reason,'ineligible_upline');
}));

test("matrix placement attaches existing root branches when a sponsor is linked later", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('a','late_a','hash','a',NULL,'2026-10-28'),('b','late_b','hash','b',NULL,'2026-10-28')");
  await db.execute("INSERT INTO users VALUES('c','late_c','hash','c','b','2026-10-28')");
  await db.execute("UPDATE users SET sponsor_id='a' WHERE id='b'");
  const placement=await db.one("SELECT p.user_id FROM matrix_slots s JOIN matrix_slots p ON p.id=s.parent_id WHERE s.user_id='b' AND s.level=1 AND s.cycle=0");
  assert.equal(placement.user_id,'a');
  await assert.rejects(db.execute("UPDATE users SET sponsor_id='c' WHERE id='a'"),{code:'23514'});
}));

test("successive matrix rebirths reserve the next unowned levels, preserve old slots and stop upgrading at 15", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('rebirth','rebirth_owner','hash','rebirth',NULL,'2026-10-28')");
  await db.transaction(()=>unlockMatrixLevel('rebirth',1,db));
  for (let cycle=0;cycle<3;cycle++) {
    for (let child=0;child<14;child++) {
      const id = `rebirth-${cycle}-${child}`;
      await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'rebirth','2026-10-28')",id);
      await db.transaction(()=>unlockMatrixLevel(id,1,db));
    }
    await db.transaction(()=>unlockMatrixLevel('rebirth',1,db));
    const charge=await db.one("SELECT * FROM referral_auto_upgrades WHERE user_id='rebirth' AND kind='rebirth' AND rebirth_cycle=$1",cycle+1);
    assert.equal(charge.level,1);
    await db.transaction(()=>completeRebirth(charge,db));
  }
  assert.deepEqual((await db.all("SELECT level FROM referral_auto_upgrades WHERE user_id='rebirth' AND kind='upgrade' ORDER BY level")).map(row=>row.level),[2,3,4]);
  assert.deepEqual((await db.all("SELECT cycle FROM matrix_slots WHERE user_id='rebirth' AND level=1 ORDER BY cycle")).map(row=>row.cycle),[0,1,2,3]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='rebirth' AND level=1 AND completed_at IS NOT NULL")).count,3);
  await db.transaction(()=>unlockMatrixLevel('rebirth',15,db));
  for (let child=0;child<14;child++) {
    const id = `rebirth-final-${child}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'rebirth','2026-10-28')",id);
    await db.transaction(()=>unlockMatrixLevel(id,1,db));
  }
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE user_id='rebirth' AND kind='upgrade'")).count,3);
  assert.equal((await db.one("SELECT MAX(cycle) AS cycle FROM matrix_slots WHERE user_id='rebirth' AND level=1")).cycle,4);
}));

test("paid rebirth migration hides unpaid overflow and preserves completed cycles and placement", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name < '0015_'));
  await db.execute("INSERT INTO users VALUES('legacy-gate','legacy_gate','hash','legacy-gate',NULL,'2026-10-29')");
  for (let i=0;i<15;i++) await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'legacy-gate','2026-10-29')",`legacy-gate-${i}`);
  await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE level=2");
  await db.execute("UPDATE matrix_slots SET completed_at='2026-10-29' WHERE user_id='legacy-gate' AND level=2 AND cycle=0");
  const placement = await db.all("SELECT id,parent_id,branch,unlocked,completed_at FROM matrix_slots ORDER BY id");
  await migrate(db.pool,sources.filter(item=>item.name < '0016_'));
  assert.deepEqual(await db.all("SELECT id,parent_id,branch,unlocked,completed_at FROM matrix_slots ORDER BY id"),placement);
  assert.deepEqual(await db.all("SELECT level,opened FROM matrix_slots WHERE user_id='legacy-gate' AND level IN (1,2) AND cycle=1 ORDER BY level"),[
    {level:1,opened:false},{level:2,opened:true},
  ]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));

test("legacy rebirth waits for the owner and every same-level branch, including prepaid overflow cycles", () => isolated(async db => {
  // Historical paid branches below unpaid owners must survive the new entry rule.
  await migrate(db.pool,sources.filter(item=>item.name<'0020_'));
  await db.execute("INSERT INTO users VALUES('gate','gate','hash','gate',NULL,'2026-10-29')");
  for (let i=0;i<42;i++) {
    const id = `gate-${i}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'gate','2026-10-29')",id);
    await db.execute("SELECT enter_referral_level($1,2)",id);
    // Leave one unpaid position in each descendant row of the initial cycle.
    if (![0,2,6].includes(i)) await db.transaction(()=>unlockMatrixLevel(id,2,db));
  }
  await migrate(db.pool,sources);
  const opened = async () => (await db.all("SELECT cycle FROM matrix_slots WHERE user_id='gate' AND level=2 AND opened ORDER BY cycle")).map(row=>row.cycle);
  assert.deepEqual(await opened(),[0]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE user_id='gate'")).count,0);
  // Paying the owner at a different level cannot open the level-2 rebirth.
  await db.transaction(()=>unlockMatrixLevel('gate',1,db));
  await db.transaction(()=>unlockMatrixLevel('gate-0',2,db));
  await db.transaction(()=>unlockMatrixLevel('gate-2',2,db));
  assert.deepEqual(await opened(),[0]);
  await db.transaction(()=>unlockMatrixLevel('gate-6',2,db));
  assert.deepEqual(await opened(),[0]); // All descendants paid, owner still unpaid.
  await db.transaction(()=>unlockMatrixLevel('gate',2,db));
  assert.deepEqual(await opened(),[0,1]);
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='gate' AND level=2 AND cycle=1")).unlocked,false);
  // Owning/upgrading the level cannot bypass the separate rebirth charge.
  await db.transaction(()=>unlockMatrixLevel('gate',2,db));
  assert.equal((await db.one("SELECT unlocked FROM matrix_slots WHERE user_id='gate' AND level=2 AND cycle=1")).unlocked,false);
  for(const cycle of [1,2,3]) {
    const charge=await db.one("SELECT * FROM referral_auto_upgrades WHERE user_id='gate' AND kind='rebirth' AND level=2 AND rebirth_cycle=$1",cycle);
    await db.transaction(()=>completeRebirth(charge,db));
  }
  assert.deepEqual(await opened(),[0,1,2,3]);
  assert.deepEqual((await db.all("SELECT cycle FROM matrix_slots WHERE user_id='gate' AND level=2 AND completed_at IS NOT NULL ORDER BY cycle")).map(row=>row.cycle),[0,1,2]);
  const jobs = await db.all("SELECT cycle_id,level FROM referral_auto_upgrades WHERE user_id='gate' ORDER BY level");
  await db.transaction(()=>unlockMatrixLevel('gate',2,db));
  assert.deepEqual(await db.all("SELECT cycle_id,level FROM referral_auto_upgrades WHERE user_id='gate' ORDER BY level"),jobs);
}));

test("historical full unilevel trees do not charge; a new fifteen-row completion queues once after all 65,534 descendants pay", { timeout:180000 }, () => isolated(async db => {
  // Build a large legacy tree directly in this disposable schema. Suppress only
  // registration placement while importing its already determined binary edges.
  await migrate(db.pool,sources.filter(item=>item.name < '0014_'));
  await db.execute("INSERT INTO users VALUES('uni-sponsor','uni-sponsor','hash','uni-sponsor',NULL,'2026-10-28')");
  await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE user_id='uni-sponsor' AND level<=2");
  await db.execute("ALTER TABLE users DISABLE TRIGGER users_place_binary_referral");
  await db.execute("ALTER TABLE users DISABLE TRIGGER users_place_matrix_slots");
  await db.execute(`INSERT INTO users(id,username,password_hash,referral_code,sponsor_id,created_at)
    SELECT 'uni-' || n,'uni_' || n,'hash','uni-' || n,CASE WHEN n=1 THEN 'uni-sponsor' ELSE NULL END,'2026-10-28' FROM generate_series(1,65535) n`);
  await db.execute("INSERT INTO referral_placements(user_id,parent_id,slot) VALUES('uni-1','uni-sponsor',0)");
  await db.execute(`INSERT INTO referral_placements(user_id,parent_id,slot)
    SELECT 'uni-' || n,'uni-' || (n/2),(n%2)::SMALLINT FROM generate_series(2,65535) n`);
  await db.execute(`INSERT INTO matrix_slots(id,user_id,level,cycle,unlocked,created_at)
    SELECT 'matrix:' || tier || ':uni-' || n || ':0','uni-' || n,tier,0,tier=1 OR n<>65535,'2026-10-28'
    FROM generate_series(1,65535) n CROSS JOIN generate_series(1,2) tier`);
  await db.execute("ALTER TABLE users ENABLE TRIGGER users_place_binary_referral");
  await db.execute("ALTER TABLE users ENABLE TRIGGER users_place_matrix_slots");
  await migrate(db.pool,sources);
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='uni-1' AND level=1")).complete_depth,15);
  assert.ok((await db.one("SELECT completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=1")).completed_at);
  assert.deepEqual(await db.one("SELECT complete_depth,completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=2"),{complete_depth:14,completed_at:null});
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
  await db.transaction(()=>unlockMatrixLevel('uni-65535',2,db));
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='uni-1' AND level=2")).complete_depth,15);
  assert.ok((await db.one("SELECT completed_at FROM unilevel_progress WHERE user_id='uni-1' AND level=2")).completed_at);
  assert.deepEqual(await db.all("SELECT user_id,level,source,source_level FROM referral_auto_upgrades WHERE kind='upgrade'"),[{user_id:'uni-1',level:3,source:'unilevel',source_level:2}]);
  assert.deepEqual(await db.one("SELECT level,rebirth_cycle,status FROM referral_auto_upgrades WHERE kind='rebirth'"),{level:2,rebirth_cycle:1,status:'queued'});
  await db.transaction(()=>unlockMatrixLevel('uni-65535',2,db));
  await db.transaction(()=>unlockMatrixLevel('uni-1',2,db));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,2);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_placements")).count,65535);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='uni-1' AND level=1")).count,1);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM unilevel_slots WHERE user_id='uni-1' AND level=2")).count,2);
  assert.deepEqual(await db.one("SELECT parent_id,branch FROM unilevel_slots WHERE user_id='uni-1' AND level=2 AND cycle=1"),
    {parent_id:'unilevel:2:uni-sponsor:0',branch:1});
}));

test("the shared upgrade queue preserves existing matrix jobs and their error history", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name < '0014_'));
  await db.execute("INSERT INTO users VALUES('preserved','preserved_member','hash','preserved',NULL,'2026-10-28')");
  await db.execute(`INSERT INTO matrix_auto_upgrades(cycle_id,user_id,level,last_error,created_at)
    VALUES('matrix:1:preserved:0','preserved',2,'Waiting for token approval.','2026-10-28')`);
  await migrate(db.pool,sources);
  assert.deepEqual(await db.one("SELECT cycle_id,user_id,level,source,source_level,slot_id,status,last_error FROM referral_auto_upgrades"),{
    cycle_id:'matrix:1:preserved:0',user_id:'preserved',level:2,source:'matrix',source_level:1,slot_id:'matrix:1:preserved:0',status:'queued',last_error:'Waiting for token approval.'
  });
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_auto_upgrades")).count,1);
}));

test("late attachment of a paid unilevel branch refreshes its new ancestors", () => isolated(async db => {
  await migrate(db.pool,sources);
  await db.execute("INSERT INTO users VALUES('up','uni_up','hash','up',NULL,'2026-10-28'),('left','uni_left','hash','left','up','2026-10-28'),('right','uni_right','hash','right',NULL,'2026-10-28')");
  for (const id of ['up','left','right']) await db.transaction(()=>unlockMatrixLevel(id,1,db));
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='up'")).complete_depth,0);
  await db.execute("UPDATE users SET sponsor_id='up' WHERE id='right'");
  assert.equal((await db.one("SELECT complete_depth FROM unilevel_progress WHERE user_id='up'")).complete_depth,1);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));

test("higher levels reference original invitations even after level-1 spillover, with stable quote retries", () => isolated(async db => {
  await migrate(db.pool,sources);
  const create=async(id,sponsor=null)=>{
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-29')",id,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${id}`,id);
  };
  await create('entry-root');
  for(const id of ['entry-a','entry-b','entry-c']) await create(id,'entry-root');
  for(const table of ['matrix_slots','unilevel_slots']) {
    assert.deepEqual((await db.all(`SELECT parent_id FROM ${table} WHERE level=2 AND user_id<>'entry-root'`)).map(row=>row.parent_id),[null,null,null]);
  }
  await db.transaction(()=>unlockMatrixLevel('entry-root',2,db));
  const quote=id=>db.transaction(()=>referralRecipients(id,2,'ledger',db));
  await quote('entry-a'); await db.transaction(()=>unlockMatrixLevel('entry-a',2,db));
  // C's level-1 placement parent is A, but its original inviter is root.
  const initial=await quote('entry-c');
  assert.equal(initial[0].userId,'entry-root'); assert.equal(initial[3].userId,'entry-root');
  await db.transaction(()=>unlockMatrixLevel('entry-c',2,db));
  const recipients=await quote('entry-b');
  assert.deepEqual(recipients.slice(0,3).map(row=>row.userId),['entry-a','entry-root',null]);
  assert.deepEqual(recipients.slice(3,6).map(row=>row.userId),['entry-a','entry-root',null]);
  assert.deepEqual(await quote('entry-b'),recipients);
  for(const program of ['matrix','unilevel']) {
    const rows=await db.all(`SELECT user_id,parent_id,branch FROM ${program}_slots WHERE level=2 AND user_id<>'entry-root' ORDER BY user_id`);
    assert.deepEqual(rows,[
      {user_id:'entry-a',parent_id:`${program}:2:entry-root:0`,branch:0},
      {user_id:'entry-b',parent_id:`${program}:2:entry-a:0`,branch:0},
      {user_id:'entry-c',parent_id:`${program}:2:entry-root:0`,branch:1},
    ]);
    assert.equal((await db.one(`SELECT parent_id FROM ${program}_slots WHERE user_id='entry-c' AND level=1 AND cycle=0`)).parent_id,`${program}:1:entry-a:0`);
  }
  // A rolled-back purchase attempt must release its position in both programs.
  await create('entry-failed','entry-root');
  await assert.rejects(db.transaction(async()=>{await referralRecipients('entry-failed',2,'ledger',db);throw new Error('failed payment');}),/failed payment/);
  assert.equal((await db.one("SELECT parent_id FROM matrix_slots WHERE user_id='entry-failed' AND level=2")).parent_id,null);
  assert.equal((await db.one("SELECT parent_id FROM unilevel_slots WHERE user_id='entry-failed' AND level=2")).parent_id,null);
}));

test("2 inviting 18 inviting 49 connects 49 to 2 at levels 2 through 15 while 18 has not upgraded", () => isolated(async db => {
  await migrate(db.pool,sources);
  for(const [id,sponsor] of [['2',null],['18','2'],['49','18'],['50','18']]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-31')",id,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${id}`,id);
    await db.transaction(()=>unlockMatrixLevel(id,1,db));
  }
  await db.transaction(()=>unlockMatrixLevel('2',15,db));
  for(let level=2;level<=15;level++) {
    const recipients=await db.transaction(()=>referralRecipients('49',level,'ledger',db));
    assert.equal(recipients[0].userId,'2',`matrix level ${level}`);
    assert.equal(recipients[3].userId,'2',`unilevel level ${level}`);
    await db.transaction(()=>unlockMatrixLevel('49',level,db));
    for(const program of ['matrix','unilevel']) {
      assert.equal((await db.one(`SELECT parent_id FROM ${program}_slots WHERE user_id='49' AND level=$1 AND cycle=0`,level)).parent_id,`${program}:${level}:2:0`);
      assert.equal((await db.one(`SELECT parent_id FROM ${program}_slots WHERE user_id='18' AND level=$1 AND cycle=0`,level)).parent_id,null);
    }
  }
  const before=await db.transaction(()=>referralRecipients('50',2,'ledger',db));
  assert.equal(before[0].userId,'2'); assert.equal(before[3].userId,'2');
  await db.transaction(()=>unlockMatrixLevel('18',3,db));
  assert.deepEqual(await db.transaction(()=>referralRecipients('50',2,'ledger',db)),before);
  // Level 3 starts from the original invitation chain, where 18 now qualifies,
  // even though the member's reserved level-2 parent is 2.
  const next=await db.transaction(()=>referralRecipients('50',3,'ledger',db));
  assert.equal(next[0].userId,'18'); assert.equal(next[3].userId,'18');
  for(const program of ['matrix','unilevel']) {
    assert.equal((await db.one(`SELECT parent_id FROM ${program}_slots WHERE user_id='49' AND level=1 AND cycle=0`)).parent_id,`${program}:1:18:0`);
    for(let level=2;level<=15;level++) {
      assert.equal((await db.one(`SELECT parent_id FROM ${program}_slots WHERE user_id='49' AND level=$1 AND cycle=0`,level)).parent_id,`${program}:${level}:2:0`);
    }
  }
}));

test("higher-level entries skip multiple unpaid inviters and parentless reservations remain stable", () => isolated(async db => {
  await migrate(db.pool,sources);
  for(const [id,sponsor] of [['skip-root',null],['skip-a','skip-root'],['skip-b','skip-a'],['skip-leaf','skip-b']]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-31')",id,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${id}`,id);
  }
  const parentless=await db.transaction(()=>referralRecipients('skip-leaf',2,'ledger',db));
  assert.ok(parentless.every(row=>row.reason==='missing_upline'));
  await db.transaction(()=>unlockMatrixLevel('skip-root',3,db));
  assert.deepEqual(await db.transaction(()=>referralRecipients('skip-leaf',2,'ledger',db)),parentless);
  const eligible=await db.transaction(()=>referralRecipients('skip-leaf',3,'ledger',db));
  assert.equal(eligible[0].userId,'skip-root'); assert.equal(eligible[3].userId,'skip-root');
  await db.execute("INSERT INTO users VALUES('skip-rollback','skip-rollback','hash','skip-rollback','skip-b','2026-10-31')");
  await assert.rejects(db.transaction(async()=>{
    await referralRecipients('skip-rollback',3,'ledger',db);
    throw new Error('failed payment');
  }),/failed payment/);
  for(const program of ['matrix','unilevel']) {
    assert.deepEqual(await db.one(`SELECT parent_id,placement_reserved FROM ${program}_slots WHERE user_id='skip-rollback' AND level=3`),{parent_id:null,placement_reserved:false});
  }
}));

test("the level-inviter migration preserves paid ancestry and quotes without reserving unused higher levels", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name<'0020_'));
  for(const [id,sponsor] of [['old-root',null],['old-middle','old-root'],['old-leaf','old-middle'],['old-quote',null]]) {
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-31')",id,sponsor);
  }
  await db.transaction(()=>unlockMatrixLevel('old-root',3,db));
  await db.transaction(()=>unlockMatrixLevel('old-leaf',2,db));
  await db.execute(`INSERT INTO referral_chain_purchases(id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,created_at,updated_at)
    VALUES('old-quote-purchase','old-quote','old-quote-key',2,20000000,80002,$1,$1,$1,$1,'{}','awaiting_signature','2026-10-31','2026-10-31')`,`0x${'12'.repeat(20)}`);
  const snapshots={};
  for(const program of ['matrix','unilevel']) snapshots[program]=await db.all(`SELECT id,parent_id,branch,unlocked,completed_at FROM ${program}_slots ORDER BY id`);
  await migrate(db.pool,sources);
  for(const program of ['matrix','unilevel']) {
    assert.deepEqual(await db.all(`SELECT id,parent_id,branch,unlocked,completed_at FROM ${program}_slots ORDER BY id`),snapshots[program]);
    assert.equal((await db.one(`SELECT placement_reserved FROM ${program}_slots WHERE user_id='old-quote' AND level=2`)).placement_reserved,true);
    assert.equal((await db.one(`SELECT placement_reserved FROM ${program}_slots WHERE user_id='old-middle' AND level=3`)).placement_reserved,false);
  }
  await db.execute("UPDATE users SET sponsor_id='old-root' WHERE id='old-quote'");
  const quote=await db.transaction(()=>referralRecipients('old-quote',2,'ledger',db));
  assert.ok(quote.every(row=>row.reason==='missing_upline'));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));

test("matrix rebirth re-enters the original referrer's next position without moving the completed branch", () => isolated(async db => {
  await migrate(db.pool,sources);
  const create=async(id,sponsor=null)=>{
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-29')",id,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${id}`,id);
    await db.transaction(()=>unlockMatrixLevel(id,1,db));
  };
  await create('rebirth-top'); await create('rebirth-child','rebirth-top');
  for(let i=0;i<13;i++) await create(`rebirth-down-${i}`,'rebirth-child');
  const before=await db.all("SELECT id,parent_id,branch FROM matrix_slots WHERE level=1 ORDER BY id");
  await create('rebirth-down-13','rebirth-child');
  const reborn=await db.one("SELECT parent_id,branch,opened,unlocked FROM matrix_slots WHERE user_id='rebirth-child' AND level=1 AND cycle=1");
  assert.deepEqual(reborn,{parent_id:'matrix:1:rebirth-top:0',branch:1,opened:true,unlocked:false});
  const charge=await db.one("SELECT * FROM referral_auto_upgrades WHERE user_id='rebirth-child' AND kind='rebirth'");
  const paymentParents=await db.transaction(()=>rebirthRecipients(charge,'ledger',db));
  assert.equal(paymentParents[0].userId,'rebirth-top');
  await db.transaction(()=>completeRebirth(charge,db));
  assert.deepEqual(await db.all("SELECT id,parent_id,branch FROM matrix_slots WHERE id=ANY($1::TEXT[]) ORDER BY id",before.map(row=>row.id)),before);
  await create('rebirth-new-buyer','rebirth-child');
  const recipients=await db.transaction(()=>referralRecipients('rebirth-new-buyer',1,'ledger',db));
  assert.deepEqual(recipients.slice(0,3).map(row=>row.userId),['rebirth-child','rebirth-top',null]);
  assert.equal((await db.one("SELECT sponsor_id FROM users WHERE id='rebirth-child'")).sponsor_id,'rebirth-top');
  await db.transaction(()=>unlockMatrixLevel('rebirth-down-13',1,db));
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM matrix_slots WHERE user_id='rebirth-child' AND level=1 AND cycle=1")).count,1);
}));

test("unilevel commissions follow fifteen parent slots at the purchased level, including connected rebirths", () => isolated(async db => {
  await migrate(db.pool,sources);
  let sponsor=null;
  for(let i=0;i<=16;i++) {
    const id=`depth-${i}`;
    await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,$2,'2026-10-29')",id,sponsor);
    await db.execute("INSERT INTO wallets(id,user_id) VALUES($1,$2)",`w-${id}`,id);
    await db.transaction(()=>unlockMatrixLevel(id,2,db)); sponsor=id;
  }
  const recipients=await db.transaction(()=>referralRecipients('depth-16',2,'ledger',db));
  assert.deepEqual(recipients.slice(3).map(row=>row.userId),Array.from({length:15},(_,i)=>`depth-${15-i}`));
  // Prepare the other fourteen full rows as a compact imported progress fixture.
  // The final real child payment must complete the slot and connect its rebirth.
  await db.execute("UPDATE unilevel_slots SET complete_depth=14 WHERE user_id='depth-2' AND level=2");
  await db.execute("INSERT INTO users VALUES('depth-sibling','depth-sibling','hash','depth-sibling','depth-1','2026-10-29')");
  await db.execute("INSERT INTO wallets(id,user_id) VALUES('w-depth-sibling','depth-sibling')");
  await db.execute("SELECT enter_referral_level('depth-sibling',2)");
  await db.execute("UPDATE unilevel_slots SET complete_depth=14 WHERE user_id='depth-sibling' AND level=2");
  await db.transaction(()=>unlockMatrixLevel('depth-sibling',2,db));
  // refresh recomputes a leaf's actual progress, so finish the paid imported
  // sibling subtree at its root and propagate through the real parent function.
  await db.execute("UPDATE unilevel_slots SET complete_depth=14 WHERE user_id='depth-sibling' AND level=2");
  await db.execute("SELECT refresh_unilevel_slot('unilevel:2:depth-1:0')");
  assert.deepEqual(await db.one("SELECT parent_id,branch,unlocked,opened FROM unilevel_slots WHERE user_id='depth-1' AND level=2 AND cycle=1"),
    {parent_id:'unilevel:2:depth-0:0',branch:1,unlocked:false,opened:true});
  const charge=await db.one("SELECT * FROM referral_auto_upgrades WHERE user_id='depth-1' AND source='unilevel' AND kind='rebirth'");
  assert.equal((await db.transaction(()=>rebirthRecipients(charge,'ledger',db)))[3].userId,'depth-0');
  await db.transaction(()=>completeRebirth(charge,db));
  await db.execute("INSERT INTO users VALUES('reborn-unilevel-buyer','reborn-unilevel-buyer','hash','reborn-unilevel-buyer','depth-1','2026-10-29')");
  // The completed cycle is skipped; a new level entry uses the connected rebirth.
  const next=await db.transaction(()=>referralRecipients('reborn-unilevel-buyer',2,'ledger',db));
  assert.deepEqual(next.slice(3,6).map(row=>row.userId),['depth-1','depth-0',null]);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades WHERE user_id='depth-1' AND source='unilevel' AND kind='upgrade'")).count,1);
  await db.transaction(()=>unlockMatrixLevel('reborn-unilevel-buyer',2,db));
  await db.execute("INSERT INTO users VALUES('reborn-unilevel-second','reborn-unilevel-second','hash','reborn-unilevel-second','depth-1','2026-10-29')");
  await db.transaction(()=>unlockMatrixLevel('reborn-unilevel-second',2,db));
  await db.execute("UPDATE unilevel_slots SET complete_depth=14 WHERE level=2 AND user_id IN ('reborn-unilevel-buyer','reborn-unilevel-second')");
  await db.execute("SELECT refresh_unilevel_slot('unilevel:2:depth-1:1')");
  await db.execute("SELECT refresh_unilevel_slot('unilevel:2:depth-1:1')");
  assert.deepEqual((await db.all("SELECT level FROM referral_auto_upgrades WHERE user_id='depth-1' AND source='unilevel' AND kind='upgrade' ORDER BY level")).map(row=>row.level),[3,4]);
  assert.deepEqual(await db.one("SELECT parent_id,branch,opened,unlocked FROM unilevel_slots WHERE user_id='depth-1' AND level=2 AND cycle=2"),
    {parent_id:'unilevel:2:depth-0:1',branch:0,opened:true,unlocked:false});
}));

test("dynamic placement migration releases unpaid reservations while preserving paid and quoted ancestry", () => isolated(async db => {
  await migrate(db.pool,sources.filter(item=>item.name<'0016_'));
  await db.execute("INSERT INTO users VALUES('m-root','m-root','hash','m-root',NULL,'2026-10-29')");
  for(const id of ['m-a','m-b','m-c']) await db.execute("INSERT INTO users VALUES($1,$1,'hash',$1,'m-root','2026-10-29')",id);
  await db.execute("UPDATE matrix_slots SET unlocked=TRUE WHERE level=2 AND user_id IN ('m-root','m-c')");
  const paid=await db.all("SELECT id,parent_id,branch FROM matrix_slots WHERE level=2 AND user_id IN ('m-root','m-a','m-c') ORDER BY id");
  await db.execute(`INSERT INTO referral_chain_purchases(id,user_id,request_key,level,amount,chain_id,contract_address,token_address,buyer_address,fee_recipient_address,payload,status,created_at,updated_at)
    VALUES('pending-placement','m-b','pending-placement',3,40000000,80002,$1,$1,$1,$1,'{}','awaiting_signature','2026-10-29','2026-10-29')`,`0x${'12'.repeat(20)}`);
  const pending=await db.one("SELECT parent_id,branch FROM matrix_slots WHERE user_id='m-b' AND level=3");
  await migrate(db.pool,sources);
  assert.deepEqual(await db.all("SELECT id,parent_id,branch FROM matrix_slots WHERE level=2 AND user_id IN ('m-root','m-a','m-c') ORDER BY id"),paid);
  assert.equal((await db.one("SELECT parent_id FROM matrix_slots WHERE user_id='m-b' AND level=2")).parent_id,null);
  assert.equal((await db.one("SELECT parent_id FROM unilevel_slots WHERE user_id='m-b' AND level=2")).parent_id,null);
  assert.deepEqual(await db.one("SELECT parent_id,branch FROM matrix_slots WHERE user_id='m-b' AND level=3"),pending);
  assert.deepEqual(await db.one("SELECT parent_id,branch FROM unilevel_slots WHERE user_id='m-b' AND level=3"),{parent_id:'unilevel:3:m-root:0',branch:1});
  assert.equal((await db.one("SELECT parent_id FROM matrix_slots WHERE user_id='m-a' AND level=4")).parent_id,null);
  assert.equal((await db.one("SELECT COUNT(*) AS count FROM referral_auto_upgrades")).count,0);
}));
