import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db, transaction } from "../server/utils/database.ts";
import { hashPassword, verifyPassword } from "../server/lib/password.ts";
import { migrate, readMigrations } from "../server/lib/migrations.ts";
import { generateEncryptedEvmWallet } from "../server/lib/evm-wallet.ts";
import { bindDatabaseNetwork } from "../server/lib/database-network.ts";
let database;
try {
    let password = process.env.LOOP_ADMIN_PASSWORD || "";
    database = db();
    await migrate(database.pool, readMigrations());
    await bindDatabaseNetwork(database,Number(process.env.NUXT_EVM_CHAIN_ID||80002));
    if (process.argv.includes("--list")) {
        const admins = await database.all("SELECT u.referral_code AS id, a.status FROM users u JOIN user_access a ON a.user_id = u.id WHERE a.role = 'admin' ORDER BY u.referral_code::BIGINT");
        for (const admin of admins) console.log(`Administrator ID ${admin.id} (${admin.status})`);
        if (!admins.length) console.log("No administrator accounts exist.");
        await database.close();
        process.exit(0);
    }
    if (!password && process.stdin.isTTY) {
        let hidden = false;
        const output = new Writable({ write(chunk, _encoding, done) { if (!hidden)
                process.stdout.write(chunk); done(); } });
        const prompt = createInterface({ input: process.stdin, output, terminal: true });
        prompt.on("SIGINT", () => { prompt.close(); process.exit(1); });
        try {
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
    if (password.length < 12 || password.length > 128)
        throw new Error("Provide a password (12-128 characters). Non-interactive setup uses LOOP_ADMIN_PASSWORD. Member IDs are assigned automatically.");
    const existingMemberId = process.env.LOOP_ADMIN_MEMBER_ID?.trim();
    const id = randomUUID();
    const passwordHash = await hashPassword(password);
    const evmWallet = process.env.NUXT_PUBLIC_WALLET_MODE === 'embedded' ? await generateEncryptedEvmWallet(password,Number(process.env.NUXT_EVM_CHAIN_ID||80002)) : null;
    const memberId = await transaction(async () => {
        if (existingMemberId) {
            const existing = await database.one("SELECT id,referral_code,password_hash FROM users WHERE referral_code=$1 FOR UPDATE",existingMemberId);
            if (!existing || !await verifyPassword(password,existing.password_hash))
                throw new Error("Provide an existing assigned LOOP_ADMIN_MEMBER_ID and that account's password.");
            if (await database.one("SELECT user_id FROM user_access WHERE user_id=$1 AND role='admin'",existing.id))
                throw new Error("This account is already an administrator.");
            await database.execute("INSERT INTO user_access(user_id,role,status) VALUES($1,'admin','active') ON CONFLICT(user_id) DO UPDATE SET role='admin',status='active'",existing.id);
            await database.execute("INSERT INTO admin_audit VALUES($1,$2,'admin_created',$2,$3)",randomUUID(),existing.id,new Date().toISOString());
            return existing.referral_code;
        }
        const created = await database.one("INSERT INTO users (id, username, password_hash, referral_code, sponsor_id, created_at) VALUES ($1, $2, $3, $4, NULL, $5) RETURNING referral_code", id, `account_${randomUUID()}`, passwordHash, `UNASSIGNED-${id}`, new Date().toISOString());
        if (!created.referral_code)
            throw new Error("Only the first account receives ID 1 at signup. Create the initial administrator before member signup, or set LOOP_ADMIN_MEMBER_ID to an existing assigned member ID and provide that account's password.");
        await database.execute("INSERT INTO wallets (id, user_id) VALUES ($1, $2)", `LW-${randomUUID()}`, id);
        if (evmWallet) await database.execute("INSERT INTO evm_wallets (user_id, address, public_key, encrypted_keystore, chain_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)", id, evmWallet.address, evmWallet.public_key, evmWallet.encrypted_keystore, evmWallet.chain_id, evmWallet.created_at);
        await database.execute("INSERT INTO user_access (user_id, role) VALUES ($1, 'admin')", id);
        await database.execute("INSERT INTO admin_audit VALUES ($1, $2, 'admin_created', $3, $4)", randomUUID(), id, id, new Date().toISOString());
        return created.referral_code;
    });
    console.log(`Administrator ID ${memberId} created. Sign in at /admin/login with this ID and your password.`);
}
catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
finally { await database?.close(); }
