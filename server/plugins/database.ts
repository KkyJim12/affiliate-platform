import { db } from "../utils/database";
import { prepareMigrations } from "../lib/migrations";

export default defineNitroPlugin(async () => {
  const assets = useStorage("assets:migrations");
  const keys = (await assets.getKeys()).filter(key => key.endsWith(".sql"));
  const sources = await Promise.all(keys.map(async name => {
    const sql = await assets.getItem<string>(name);
    if (typeof sql !== "string") throw new Error(`Database migration asset is unavailable: ${name}`);
    return { name, sql };
  }));
  db(prepareMigrations(sources));
});
