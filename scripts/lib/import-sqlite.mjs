// The application never uses SQLite. This one-time importer reads old installations.
export async function importSqlite(sourcePath, database) {
  const { DatabaseSync } = await import("node:sqlite");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const tables = {
    users: ["id", "username", "password_hash", "referral_code", "sponsor_id", "created_at"],
    wallets: ["id", "user_id", "available", "reserved"],
    sessions: ["token_hash", "user_id", "expires_at"],
    wallet_transactions: ["id", "wallet_id", "type", "amount", "status", "description", "request_key", "created_at"],
    user_access: ["user_id", "role", "status"],
    payment_reviews: ["transaction_id", "decision", "reference", "note", "admin_id", "created_at"],
    referral_activations: ["user_id", "transaction_id", "created_at"],
    admin_audit: ["id", "admin_id", "action", "target", "created_at"],
    rate_limits: ["key", "count", "resets_at"],
    platform_settings: ["id", "registration_open", "funding_open", "support_email"],
  };
  try {
    source.exec("BEGIN");
    const existing = new Set(source.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    if (!["users", "wallets", "sessions", "wallet_transactions"].every(table => existing.has(table))) throw new Error("The source is not an UNXO SQLite database.");
    return await database.transaction(async () => {
      await database.execute(`LOCK TABLE ${Object.keys(tables).join(", ")} IN ACCESS EXCLUSIVE MODE`);
      for (const table of Object.keys(tables).filter(table => table !== "platform_settings")) {
        if ((await database.one(`SELECT COUNT(*) AS total FROM ${table}`)).total) throw new Error("Import requires an empty PostgreSQL destination. Existing data was not changed.");
      }
      const settings = await database.one("SELECT * FROM platform_settings WHERE id = 1");
      if (settings.registration_open !== 1 || settings.funding_open !== 1 || settings.support_email !== "") throw new Error("Import requires default destination settings. Existing settings were not changed.");
      const counts = {};
      const sponsors = [];
      for (const [table, columns] of Object.entries(tables)) {
        if (!existing.has(table)) continue;
        const rows = source.prepare(`SELECT ${columns.join(", ")} FROM ${table} ORDER BY rowid`).all();
        for (const row of rows) {
          if (table === "users" && row.sponsor_id) { sponsors.push([row.sponsor_id, row.id]); row.sponsor_id = null; }
          const sql = table === "platform_settings"
            ? "UPDATE platform_settings SET registration_open = $2, funding_open = $3, support_email = $4 WHERE id = $1"
            : `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((_, index) => `$${index + 1}`).join(", ")})`;
          await database.query(sql, columns.map(column => row[column]));
        }
        counts[table] = rows.length;
      }
      for (const [sponsor, id] of sponsors) await database.execute("UPDATE users SET sponsor_id = $1 WHERE id = $2", sponsor, id);
      return counts;
    });
  } finally { source.close(); }
}
