import { backupConfig, createBackup, pruneBackups, sendBackup } from './lib/database-backup.mjs';

try {
  if (process.argv.slice(2).some(arg => arg !== '--local-only')) throw Error('Usage: db:backup [-- --local-only]');
  const localOnly = process.argv.includes('--local-only');
  const config = backupConfig(process.env, { localOnly });
  const backup = await createBackup(config);
  console.log(`Encrypted database backup: ${backup.path}\nSHA-256: ${backup.sha256}`);
  if (!localOnly) { await sendBackup(config, backup); console.log('Backup email accepted by SMTP server.'); }
  await pruneBackups(config);
} catch (error) { console.error(error.message); process.exitCode = 1; }
