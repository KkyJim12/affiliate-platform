import { createDatabase } from "../lib/postgres.ts";

let database: ReturnType<typeof createDatabase> | undefined;

export function db() { return database ??= createDatabase(); }

export function transaction<T>(operation: () => Promise<T>): Promise<T> {
  return db().transaction(operation);
}
