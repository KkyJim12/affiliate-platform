import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { migrate, readMigrations, type Migration } from "../lib/migrations.ts";

let database: DatabaseSync | undefined;

export function db(migrations?: readonly Migration[]) {
  if (database) return database;
  const sources = migrations ?? readMigrations();
  const path = resolve(process.env.LOOP_DATABASE_PATH || ".data/loop.sqlite");
  mkdirSync(dirname(path), { recursive: true });
  const connection = new DatabaseSync(path);
  try {
    connection.exec("PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
    migrate(connection, sources);
    database = connection;
    return connection;
  } catch (error) {
    connection.close();
    throw error;
  }
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
