# Daily database backups

The production Node server can email an encrypted PostgreSQL backup every day
at **03:00 Asia/Bangkok**. Set the following privately in the deployed `.env`
(or `.env.mainnet` when using the mainnet commands), then restart the server:

```dotenv
BACKUP_ENABLED=true
BACKUP_TO_EMAIL=recipient@example.com
BACKUP_FROM_EMAIL=backups@example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=backups@example.com
SMTP_PASSWORD=your-smtp-password
BACKUP_ENCRYPTION_KEY=your-64-character-hex-key
BACKUP_TIME=03:00
BACKUP_TIMEZONE=Asia/Bangkok
BACKUP_PG_DUMP_PATH=pg_dump
BACKUP_DIRECTORY=/var/lib/unxo/backups
BACKUP_RETENTION_DAYS=30
BACKUP_MAX_ATTACHMENT_MB=18
```

Generate the encryption key **once**, and store another copy in your password
manager, separately from email:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Install PostgreSQL client tools on the server. `pg_dump` must be the same major
version as the database server or newer. The server account needs permission to
execute it, read the database and write the backup directory. Use a persistent
directory outside an ephemeral release folder. The source and built Node server
both include the scheduler; it needs a continuously running Node process.
Static hosting cannot run it. Configuration is server-only, never public Nuxt env.

Backups use PostgreSQL's compressed custom archive format and streaming
AES-256-GCM encryption: no unencrypted dump is written during backup. The
attachment includes a SHA-256 checksum in the email body. SMTP requires TLS
(STARTTLS on 587, implicit TLS on 465). SMTP credentials and encryption keys
are never included in the attachment or email body.

The job checks once a minute. A server starting after the scheduled time catches
up for the current day; earlier missed days are not reconstructed. A shared
PostgreSQL advisory lock and `database_backup_runs` prevent competing jobs and
repeat sends after restarts. Failed delivery retries after 15 minutes, up to
four attempts per date, reusing the encrypted archive when available. A crash
after SMTP acceptance but before success is recorded can cause a repeat email.
SMTP acceptance is recorded as sent; it does not guarantee inbox delivery.

Archives older than 30 days are removed after successful scheduled delivery.
Failed emails retain the local archive. The default 18 MiB attachment ceiling
leaves room for MIME encoding under common email limits; oversized backups
fail without sending and retain their local copy. Increase the ceiling only if
your mail provider supports it. A successful database dump does not back up
`.env` secrets, database server roles, or files outside PostgreSQL; keep those
separately.

Check job status without revealing credentials:

```sql
SELECT scheduled_date,status,attempts,attempted_at,completed_at,filename,last_error
FROM database_backup_runs ORDER BY scheduled_date DESC LIMIT 14;
```

Run an immediate backup and email, or create a local archive without sending:

```bash
npm run db:mainnet:backup
npm run db:mainnet:backup -- --local-only
```

For `.env`, use `npm run db:backup`. Manual runs are separate from the daily
delivery record. The app applies migration `0025_daily_database_backups.sql`
on startup; `npm run db:mainnet:migrate` can also apply it before deployment.

## Recovery

Use the original encryption key in your env file. Decryption refuses to replace
an existing output file and rejects a wrong key or damaged archive:

```bash
npm run db:mainnet:backup:decrypt -- backup.dump.enc recovered.dump
pg_restore --list recovered.dump
pg_restore --no-owner --no-acl --dbname=NEW_EMPTY_DATABASE recovered.dump
```

Use `db:backup:decrypt` for `.env`. Restore to an empty isolated database first
and verify accounts, migrations and ledger history before recovery. Database
restoration does not reverse blockchain transactions. Remove the decrypted dump
when recovery is finished.

References: [PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html),
[Nodemailer SMTP](https://nodemailer.com/smtp).
