import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db, transaction } from "../server/utils/database.ts";
import { hashPassword } from "../server/lib/password.ts";
import { migrate, readMigrations } from "../server/lib/migrations.ts";
import { generateEncryptedEvmWallet } from "../server/lib/evm-wallet.ts";
let database;
try {
    let username = process.env.LOOP_ADMIN_USERNAME || "";
    let password = process.env.LOOP_ADMIN_PASSWORD || "";
    if ((!username || !password) && process.stdin.isTTY) {
        let hidden = false;
        const output = new Writable({ write(chunk, _encoding, done) { if (!hidden)
                process.stdout.write(chunk); done(); } });
        const prompt = createInterface({ input: process.stdin, output, terminal: true });
        prompt.on("SIGINT", () => { prompt.close(); process.exit(1); });
        try {
            if (!username)
                username = await prompt.question("Admin username: ");
            if (!password) {
                process.stdout.write("Admin password (12-128 characters, hidden): ");
                hidden = true;
                password = await prompt.question("");
                hidden = false;
                process.stdout.write("\n");
            }
        }
        finally {
            prompt.close();
        }
    }
    username = username.trim().toLowerCase();
    if (!/^[a-z][a-z0-9_]{2,23}$/.test(username) || password.length < 12 || password.length > 128)
        throw new Error("Provide a username (3-24 letters, numbers, underscores, starting with a letter) and a password (12-128 characters). Non-interactive setup uses LOOP_ADMIN_USERNAME and LOOP_ADMIN_PASSWORD.");
    database = db();
    await migrate(database.pool, readMigrations());
    if (await database.one("SELECT id FROM users WHERE username = $1", username))
        throw new Error("That username already exists. Choose a new administrator username.");
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const evmWallet = await generateEncryptedEvmWallet(password);
    await transaction(async () => {
        await database.execute("INSERT INTO users (id, username, password_hash, referral_code, sponsor_id, created_at) VALUES ($1, $2, $3, $4, NULL, $5)", id, username, passwordHash, `UNXO-${randomUUID().slice(0, 8).toUpperCase()}`, new Date().toISOString());
        await database.execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", `LW-${randomUUID()}`, id);
        await database.execute("INSERT INTO evm_wallets (user_id, address, public_key, encrypted_keystore, chain_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)", id, evmWallet.address, evmWallet.public_key, evmWallet.encrypted_keystore, evmWallet.chain_id, evmWallet.created_at);
        await database.execute("INSERT INTO user_access (user_id, role) VALUES ($1, 'admin')", id);
        await database.execute("INSERT INTO admin_audit VALUES ($1, $2, 'admin_created', $3, $4)", randomUUID(), id, username, new Date().toISOString());
    });
    console.log(`Administrator @${username} created. Sign in at /admin/login.`);
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
finally { await database?.close(); }
