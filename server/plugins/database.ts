import { db } from "../utils/database";
import { migrate, prepareMigrations } from "../lib/migrations";
import { bindDatabaseNetwork } from "../lib/database-network";
import { appNetwork } from "../utils/network";

export default defineNitroPlugin(async nitro => {
  const assets = useStorage("assets:migrations");
  const keys = (await assets.getKeys()).filter(key => key.endsWith(".sql"));
  const sources = await Promise.all(keys.map(async name => {
    const sql = await assets.getItem<string>(name);
    if (typeof sql !== "string") throw new Error(`Database migration asset is unavailable: ${name}`);
    return { name, sql };
  }));
  await migrate(db().pool, prepareMigrations(sources));
  await bindDatabaseNetwork(db(),appNetwork().chainId);
  nitro.hooks.hook("close", () => db().close());
});
