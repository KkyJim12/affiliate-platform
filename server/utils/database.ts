import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

let database: DatabaseSync | undefined;

export function db() {
  if (database) return database;
  const path = resolve(process.env.LOOP_DATABASE_PATH || ".data/loop.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  database = new DatabaseSync(path);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      referral_code TEXT NOT NULL UNIQUE,
      sponsor_id TEXT REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS users_sponsor ON users(sponsor_id, created_at);
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
      available INTEGER NOT NULL DEFAULT 0 CHECK (available >= 0),
      reserved INTEGER NOT NULL DEFAULT 0 CHECK (reserved >= 0)
    );
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      wallet_id TEXT NOT NULL REFERENCES wallets(id),
      type TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL CHECK (status IN ('pending', 'completed')),
      description TEXT NOT NULL,
      request_key TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(wallet_id, request_key)
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL,
      resets_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_access (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended'))
    );
    CREATE TABLE IF NOT EXISTS payment_reviews (
      transaction_id TEXT PRIMARY KEY REFERENCES wallet_transactions(id),
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
      reference TEXT UNIQUE COLLATE NOCASE,
      note TEXT NOT NULL,
      admin_id TEXT NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS platform_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      registration_open INTEGER NOT NULL DEFAULT 1,
      funding_open INTEGER NOT NULL DEFAULT 1,
      support_email TEXT NOT NULL DEFAULT ''
    );
    INSERT OR IGNORE INTO platform_settings (id) VALUES (1);
    CREATE TABLE IF NOT EXISTS admin_audit (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      target TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  return database;
}

export function transaction<T>(operation: () => T): T {
  const connection = db();
  connection.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    connection.exec("COMMIT");
    return result;
  } catch (error) {
    connection.exec("ROLLBACK");
    throw error;
  }
}
