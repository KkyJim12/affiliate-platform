import { decryptBackup } from './lib/database-backup.mjs';

try {
  const [input, output, ...extra] = process.argv.slice(2);
  if (!input || !output || extra.length) throw Error('Usage: db:backup:decrypt -- encrypted.dump.enc restored.dump');
  if (!/^[a-fA-F0-9]{64}$/.test(process.env.BACKUP_ENCRYPTION_KEY ?? '')) throw Error('Set the original BACKUP_ENCRYPTION_KEY.');
  await decryptBackup(input, output, Buffer.from(process.env.BACKUP_ENCRYPTION_KEY, 'hex'));
  console.log(`Decrypted PostgreSQL archive: ${output}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
