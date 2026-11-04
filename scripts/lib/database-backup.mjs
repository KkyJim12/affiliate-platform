import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { appendFile, mkdir, open, readdir, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Pool } from 'pg';
import nodemailer from 'nodemailer';

const magic = Buffer.from('UNXOBK01');
const archiveName = /^unxo-db-\d{8}T\d{9}Z-[a-f0-9-]+\.dump\.enc$/;
const email = /^[^\s<>@,\r\n]+@[^\s<>@,\r\n]+\.[^\s<>@,\r\n]+$/;

function integer(value, fallback, min, max, name) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < min || number > max) throw Error(`Invalid ${name}.`);
  return number;
}

export function backupConfig(env = process.env, { localOnly = false } = {}) {
  if (!/^postgres(?:ql)?:\/\//.test(env.DATABASE_URL ?? '')) throw Error('Set DATABASE_URL for database backups.');
  if (!/^[a-fA-F0-9]{64}$/.test(env.BACKUP_ENCRYPTION_KEY ?? ''))
    throw Error('Set BACKUP_ENCRYPTION_KEY to a private 32-byte hex key.');
  const time = env.BACKUP_TIME || '03:00', timezone = env.BACKUP_TIMEZONE || 'Asia/Bangkok';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw Error('BACKUP_TIME must use HH:MM.');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }).format(); }
  catch { throw Error('Invalid BACKUP_TIMEZONE.'); }
  const port = integer(env.SMTP_PORT, 587, 1, 65535, 'SMTP_PORT');
  if (!localOnly && (!email.test(env.BACKUP_TO_EMAIL ?? '') || !email.test(env.BACKUP_FROM_EMAIL ?? '') || !env.SMTP_HOST))
    throw Error('Set BACKUP_TO_EMAIL, BACKUP_FROM_EMAIL and SMTP_HOST before enabling email backups.');
  if (!localOnly && Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD))
    throw Error('Set SMTP_USER and SMTP_PASSWORD together.');
  return {
    databaseUrl: env.DATABASE_URL, key: Buffer.from(env.BACKUP_ENCRYPTION_KEY, 'hex'),
    directory: resolve(env.BACKUP_DIRECTORY || '.data/backups'), pgDump: env.BACKUP_PG_DUMP_PATH || 'pg_dump',
    time, timezone, to: env.BACKUP_TO_EMAIL, from: env.BACKUP_FROM_EMAIL,
    retentionDays: integer(env.BACKUP_RETENTION_DAYS, 30, 1, 3650, 'BACKUP_RETENTION_DAYS'),
    maxBytes: integer(env.BACKUP_MAX_ATTACHMENT_MB, 18, 1, 100, 'BACKUP_MAX_ATTACHMENT_MB') * 1024 * 1024,
    smtp: { host: env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } } : {}),
      connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 120_000, disableUrlAccess: true },
  };
}

export function scheduledBackupDate(config, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}` >= config.time ? `${parts.year}-${parts.month}-${parts.day}` : null;
}

export async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export function dumpConnection(databaseUrl) {
  const url = new URL(databaseUrl);
  const user = url.searchParams.get('user') ?? decodeURIComponent(url.username);
  const password = url.searchParams.get('password') ?? decodeURIComponent(url.password);
  const sslPassword = url.searchParams.get('sslpassword');
  url.username = ''; url.password = '';
  for (const name of ['user','password','sslpassword']) url.searchParams.delete(name);
  // libpq does not expand a URI supplied only through PGDATABASE. Pass an
  // explicit credential-free URI and keep passwords in the child environment.
  return { uri: url.href, env: { PGUSER: user, PGPASSWORD: password,
    ...(sslPassword ? { PGSSLPASSWORD: sslPassword } : {}) } };
}

export async function createBackup(config, spawnProcess = spawn) {
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const filename = `unxo-db-${new Date().toISOString().replace(/[-:.]/g, '')}-${randomUUID()}.dump.enc`;
  const path = join(config.directory, filename), partial = `${path}.partial`;
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', config.key, iv);
  const header = Buffer.concat([magic, iv]);
  cipher.setAAD(header);
  const output = createWriteStream(partial, { flags: 'wx', mode: 0o600 });
  output.write(header);
  const connection = dumpConnection(config.databaseUrl);
  // pg_dump takes a consistent snapshot without stopping writes.
  const child = spawnProcess(config.pgDump, ['--format=custom', '--no-password', `--dbname=${connection.uri}`], {
    env: { ...process.env, ...connection.env, PGCONNECT_TIMEOUT: '15' },
    stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 15 * 60_000,
  });
  const completion = new Promise((done, fail) => {
    child.once('error', () => fail(Error('Could not start pg_dump. Install PostgreSQL client tools or set BACKUP_PG_DUMP_PATH.')));
    child.once('close', code => code === 0 ? done() : fail(Error('pg_dump failed. Check database access and PostgreSQL client version.')));
  });
  try {
    const results = await Promise.allSettled([completion, pipeline(child.stdout, cipher, output)]);
    const failed = results.find(result => result.status === 'rejected');
    if (failed) throw failed.reason;
    await appendFile(partial, cipher.getAuthTag());
    await rename(partial, path);
    return { filename, path, sha256: await fileHash(path), bytes: (await stat(path)).size };
  } catch (error) {
    child.kill();
    await rm(partial, { force: true });
    throw error;
  }
}

export async function decryptBackup(input, output, key) {
  if (resolve(input) === resolve(output)) throw Error('Choose a separate output file.');
  const source = await open(input, 'r');
  let header, tag, size;
  try {
    size = (await source.stat()).size;
    if (size < 36) throw Error('Invalid encrypted backup.');
    header = Buffer.alloc(20); tag = Buffer.alloc(16);
    await source.read(header, 0, 20, 0); await source.read(tag, 0, 16, size - 16);
  } finally { await source.close(); }
  if (!header.subarray(0, 8).equals(magic)) throw Error('Invalid encrypted backup header.');
  const decipher = createDecipheriv('aes-256-gcm', key, header.subarray(8));
  decipher.setAAD(header); decipher.setAuthTag(tag);
  // Create exclusively, and remove output on authentication failure.
  const destination = await open(output, 'wx', 0o600);
  try {
    await pipeline(createReadStream(input, { start: 20, end: size - 17 }), decipher, destination.createWriteStream());
  } catch {
    await destination.close();
    await rm(output, { force: true });
    throw Error('Backup decryption failed. Check the key and file integrity.');
  }
}

export async function sendBackup(config, backup, createTransport = nodemailer.createTransport) {
  if (backup.bytes > config.maxBytes) throw Error('Backup exceeds BACKUP_MAX_ATTACHMENT_MB; encrypted local copy retained.');
  const transport = createTransport(config.smtp);
  try {
    const sent = await transport.sendMail({ from: config.from, to: config.to,
      subject: `UNXO database backup — ${new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone,
        year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())}`,
      text: `Encrypted PostgreSQL backup attached.\nFile: ${backup.filename}\nSHA-256: ${backup.sha256}\n\nUse your separately saved BACKUP_ENCRYPTION_KEY to decrypt this file.`,
      attachments: [{ filename: backup.filename, path: backup.path, contentType: 'application/octet-stream' }],
    });
    if (!sent.accepted?.length || sent.rejected?.length) throw Error('Email recipient was not accepted.');
  } catch {
    throw Error('Backup email delivery failed. Check recipient, SMTP settings and attachment limits; local copy retained.');
  } finally { transport.close(); }
}

export async function pruneBackups(config, now = Date.now()) {
  const cutoff = now - config.retentionDays * 86400_000;
  for (const filename of await readdir(config.directory)) {
    if (!archiveName.test(filename)) continue;
    const path = join(config.directory, filename);
    if ((await stat(path)).mtimeMs < cutoff) await rm(path);
  }
}

// One session advisory lock covers dumping, sending and recording success.
// Persisted dates avoid duplicate daily sends across replicas and restarts.
export async function runDailyBackup(config, scheduledDate, pool, operations = {}) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(782438,3) AS locked')).rows[0].locked;
    if (!locked) return 'busy';
    const result = await client.query(`INSERT INTO database_backup_runs(scheduled_date,status) VALUES($1,'pending')
      ON CONFLICT(scheduled_date) DO UPDATE SET status='pending',attempts=database_backup_runs.attempts+1,
        attempted_at=CURRENT_TIMESTAMP,last_error=NULL
      WHERE database_backup_runs.status<>'sent' AND database_backup_runs.attempts<4
        AND database_backup_runs.attempted_at < CURRENT_TIMESTAMP-INTERVAL '15 minutes'
      RETURNING filename,sha256`, [scheduledDate]);
    if (!result.rowCount) return 'skipped';
    try {
      const previous = result.rows[0];
      let backup;
      if (archiveName.test(previous.filename ?? '')) {
        const path = join(config.directory, previous.filename);
        // Reuse the exact encrypted archive after mail failures; never attach
        // an arbitrary filesystem path recorded in a restored database.
        try {
          if (await fileHash(path) === previous.sha256)
            backup = { filename: previous.filename, path, sha256: previous.sha256, bytes: (await stat(path)).size };
        } catch { /* A missing local archive is recreated from the database. */ }
      }
      backup ??= await (operations.createBackup ?? createBackup)(config);
      await client.query('UPDATE database_backup_runs SET filename=$2,sha256=$3 WHERE scheduled_date=$1', [scheduledDate, backup.filename, backup.sha256]);
      await (operations.sendBackup ?? sendBackup)(config, backup);
      await client.query("UPDATE database_backup_runs SET status='sent',completed_at=CURRENT_TIMESTAMP,last_error=NULL WHERE scheduled_date=$1", [scheduledDate]);
      await (operations.pruneBackups ?? pruneBackups)(config);
      return 'sent';
    } catch (error) {
      // Only operational messages are persisted, never raw pg/SMTP errors.
      const message = error instanceof Error && /^(Backup |pg_dump |Could not start pg_dump)/.test(error.message)
        ? error.message : 'Database backup failed; check server logs and backup configuration.';
      await client.query("UPDATE database_backup_runs SET status='failed',last_error=$2 WHERE scheduled_date=$1 AND status<>'sent'", [scheduledDate, message]);
      throw Error(message);
    }
  } finally {
    try { if (locked) await client.query('SELECT pg_advisory_unlock(782438,3)'); }
    finally { client.release(); }
  }
}

export function startBackupScheduler(env = process.env) {
  if (env.BACKUP_ENABLED !== 'true') return async () => {};
  // Validate on startup so enabled but incomplete delivery cannot go unnoticed.
  const config = backupConfig(env);
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1, connectionTimeoutMillis: 10_000 });
  pool.on('error', () => console.error('[backup] Database connection lost.'));
  let running;
  const tick = () => {
    const date = scheduledBackupDate(config);
    if (!date || running) return;
    running = runDailyBackup(config, date, pool)
      .then(status => { if (status === 'sent') console.log(`[backup] Daily encrypted backup emailed for ${date}.`); })
      .catch(() => console.error('[backup] Daily backup failed; inspect database_backup_runs for delivery status.'))
      .finally(() => { running = undefined; });
  };
  const timer = setInterval(tick, 60_000);
  timer.unref(); tick();
  console.log(`[backup] Daily schedule enabled at ${config.time} (${config.timezone}).`);
  return async () => { clearInterval(timer); await running; await pool.end(); };
}
