import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { backupConfig, createBackup, decryptBackup, dumpConnection, fileHash, pruneBackups, scheduledBackupDate, sendBackup, startBackupScheduler } from '../scripts/lib/database-backup.mjs';

const env = { DATABASE_URL: 'postgresql://user:secret@localhost/test', BACKUP_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  BACKUP_TO_EMAIL: 'owner@example.com', BACKUP_FROM_EMAIL: 'backups@example.com', SMTP_HOST: 'smtp.example.com' };

test('backup config validates delivery and private encryption settings; TLS is required', () => {
  const config = backupConfig(env);
  assert.equal(config.time, '03:00'); assert.equal(config.timezone, 'Asia/Bangkok');
  assert.equal(config.smtp.requireTLS, true); assert.equal(config.smtp.secure, false);
  assert.equal(backupConfig({ ...env, SMTP_PORT: '465' }).smtp.secure, true);
  for (const changes of [{ DATABASE_URL: '' }, { BACKUP_ENCRYPTION_KEY: '' }, { BACKUP_ENCRYPTION_KEY: 'abcd' },
    { BACKUP_TO_EMAIL: 'a@example.com\r\nBcc:other@example.com' }, { SMTP_HOST: '' }, { SMTP_USER: 'user' },
    { BACKUP_TIME: '25:00' }, { BACKUP_TIMEZONE: 'invalid-zone' }, { BACKUP_RETENTION_DAYS: '0' }, { SMTP_PORT: 'abc' }])
    assert.throws(() => backupConfig({ ...env, ...changes }));
  assert.doesNotThrow(() => backupConfig({ ...env, BACKUP_TO_EMAIL: '', SMTP_HOST: '' }, { localOnly: true }));
});

test('daily schedule uses Bangkok date, catches up after startup, and respects time-zone transitions', () => {
  const config = backupConfig(env);
  assert.equal(scheduledBackupDate(config, new Date('2026-11-03T19:59:00Z')), null);
  assert.equal(scheduledBackupDate(config, new Date('2026-11-03T20:00:00Z')), '2026-11-04');
  assert.equal(scheduledBackupDate(config, new Date('2026-11-04T16:59:00Z')), '2026-11-04');
  assert.equal(scheduledBackupDate(config, new Date('2026-11-04T17:00:00Z')), null);
  const dst = { ...config, timezone: 'America/New_York' };
  assert.equal(scheduledBackupDate(dst, new Date('2026-11-01T07:59:00Z')), null);
  assert.equal(scheduledBackupDate(dst, new Date('2026-11-01T08:00:00Z')), '2026-11-01');
});

test('libpq gets an explicit URI with encoded credentials removed and SSL options preserved', () => {
  const connection = dumpConnection('postgresql://owner:p%40ss@db.example.com:5433/mainnet?sslmode=verify-full');
  assert.equal(connection.uri, 'postgresql://db.example.com:5433/mainnet?sslmode=verify-full');
  assert.deepEqual(connection.env, { PGUSER: 'owner', PGPASSWORD: 'p@ss' });
  const query = dumpConnection('postgresql://db/mainnet?user=owner&password=secret&sslpassword=private&sslmode=require');
  assert.equal(query.uri, 'postgresql://db/mainnet?sslmode=require');
  assert.deepEqual(query.env, { PGUSER: 'owner', PGPASSWORD: 'secret', PGSSLPASSWORD: 'private' });
});

test('dump is streamed into authenticated encryption, decrypts exactly, and keeps credentials out of arguments', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unxo-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = { ...backupConfig(env), directory }, content = Buffer.from('PGDMP private account and ledger data');
  const fakeDump = (executable, args, options) => {
    assert.deepEqual(args, ['--format=custom', '--no-password', '--dbname=postgresql://localhost/test']);
    assert.equal(options.env.PGPASSWORD, 'secret');
    assert.equal(args.join(' ').includes('secret'), false);
    assert.equal(options.windowsHide, true);
    const child = new EventEmitter(); child.stdout = Readable.from(content); child.kill = () => {};
    child.stdout.once('end', () => child.emit('close', 0)); return child;
  };
  const backup = await createBackup(config, fakeDump);
  const encrypted = await readFile(backup.path);
  assert.equal(encrypted.includes(content), false); assert.equal(backup.sha256, await fileHash(backup.path));
  assert.match(backup.filename, /^unxo-db-.*\.dump\.enc$/);
  const output = join(directory, 'restored.dump');
  await decryptBackup(backup.path, output, config.key);
  assert.deepEqual(await readFile(output), content);
  await assert.rejects(decryptBackup(backup.path, output, config.key), { code: 'EEXIST' });
  assert.deepEqual(await readFile(output), content);
  const badOutput = join(directory, 'wrong-key.dump');
  await assert.rejects(decryptBackup(backup.path, badOutput, randomBytes(32)), /decryption failed/);
  assert.equal((await readdir(directory)).includes('wrong-key.dump'), false);
  encrypted[25] ^= 1; await writeFile(backup.path, encrypted);
  await assert.rejects(decryptBackup(backup.path, badOutput, config.key), /decryption failed/);
});

test('failed pg_dump leaves no final or partial backup', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unxo-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await assert.rejects(createBackup({ ...backupConfig(env), directory }, () => {
    const child = new EventEmitter(); child.stdout = Readable.from('incomplete'); child.kill = () => {};
    child.stdout.once('end', () => child.emit('close', 1)); return child;
  }), /pg_dump failed/);
  assert.deepEqual(await readdir(directory), []);
});

test('email attaches only the encrypted archive; rejected or oversized deliveries fail', async () => {
  const config = backupConfig(env), backup = { filename: 'backup.dump.enc', path: '/private/backup.dump.enc', sha256: 'checksum', bytes: 1024 };
  let closed = false, sent;
  const transport = () => ({ close() { closed = true; }, async sendMail(message) { sent = message; return { accepted: [env.BACKUP_TO_EMAIL], rejected: [] }; } });
  await sendBackup(config, backup, transport);
  assert.equal(sent.to, env.BACKUP_TO_EMAIL); assert.equal(closed, true);
  assert.equal(JSON.stringify(sent).includes(env.BACKUP_ENCRYPTION_KEY), false);
  assert.deepEqual(sent.attachments.map(file => file.path), [backup.path]);
  await assert.rejects(sendBackup(config, { ...backup, bytes: config.maxBytes + 1 }, transport), /exceeds/);
  await assert.rejects(sendBackup(config, backup, () => ({ close() {}, async sendMail() { return { accepted: [], rejected: [env.BACKUP_TO_EMAIL] }; } })), /delivery failed/);
});

test('retention removes only old generated encrypted backups and leaves other files alone', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'unxo-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = 'unxo-db-20260101T030000000Z-abcd.dump.enc', recent = 'unxo-db-20261104T030000000Z-abcd.dump.enc';
  for (const file of [old, recent, 'operator-file.dump.enc']) await writeFile(join(directory, file), 'backup');
  for (const file of [old, 'operator-file.dump.enc']) await utimes(join(directory, file), new Date('2026-01-01'), new Date('2026-01-01'));
  await pruneBackups({ directory, retentionDays: 30 }, Date.now());
  assert.deepEqual((await readdir(directory)).sort(), ['operator-file.dump.enc', recent].sort());
});

test('disabled scheduler needs no SMTP or database connection', async () => {
  const stop = startBackupScheduler({ BACKUP_ENABLED: 'false' });
  await stop();
});
