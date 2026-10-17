import { AsyncLocalStorage } from "node:async_hooks";
import { Pool, types, type PoolClient, type QueryResultRow } from "pg";

// BIGINT balances and NUMERIC aggregate results must remain exact JS integers.
const parseInteger = (value: string) => {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) throw new Error("Database integer exceeds the supported safe range.");
  return number;
};
const databaseTypes = { getTypeParser: (oid: number, format?: string) =>
  oid === 20 || oid === 1700 ? parseInteger : types.getTypeParser(oid, format as "text") };

export function createDatabase(connectionString = process.env.DATABASE_URL) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//.test(connectionString)) {
    throw new Error("Set DATABASE_URL to a PostgreSQL connection URL. See .env.example.");
  }
  const pool = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 5000, types: databaseTypes });
  pool.on("error", () => console.error("An idle PostgreSQL connection was lost."));
  const context = new AsyncLocalStorage<PoolClient>();
  const query = <T extends QueryResultRow = QueryResultRow>(sql: string, values: unknown[] = []) =>
    (context.getStore() ?? pool).query<T>(sql, values);
  return {
    pool,
    query,
    async one<T extends QueryResultRow = QueryResultRow>(sql: string, ...values: unknown[]): Promise<T | undefined> {
      return (await query<T>(sql, values)).rows[0];
    },
    async all<T extends QueryResultRow = QueryResultRow>(sql: string, ...values: unknown[]): Promise<T[]> {
      return (await query<T>(sql, values)).rows;
    },
    async execute(sql: string, ...values: unknown[]) { return query(sql, values); },
    async transaction<T>(operation: () => Promise<T>): Promise<T> {
      if (context.getStore()) throw new Error("Nested database transactions are not supported.");
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await context.run(client, operation);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    },
    close: () => pool.end(),
  };
}
