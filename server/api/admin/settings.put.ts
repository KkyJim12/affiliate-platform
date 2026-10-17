import { assertSameOrigin, rateLimit, requireAdmin } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { audit, platformSettings } from "../../utils/admin";

export default defineEventHandler(async event => {
  assertSameOrigin(event);
  const admin = requireAdmin(event);
  rateLimit(event, `admin-settings:${admin.id}`, 30);
  const body = await readBody(event);
  const supportEmail = typeof body?.supportEmail === "string" ? body.supportEmail.trim() : null;
  if (typeof body?.registrationOpen !== "boolean" || typeof body?.fundingOpen !== "boolean" || supportEmail === null || supportEmail.length > 254 || (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail))) throw createError({ statusCode: 400, statusMessage: "Enter valid platform settings and a valid support email." });
  transaction(() => {
    db().prepare("UPDATE platform_settings SET registration_open = ?, funding_open = ?, support_email = ? WHERE id = 1").run(Number(body.registrationOpen), Number(body.fundingOpen), supportEmail);
    audit(admin.id, "settings_updated", "platform");
  });
  return platformSettings();
});
