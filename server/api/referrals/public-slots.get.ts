import { isMemberId } from "../../../shared/referral-code";
import { db } from "../../utils/database";
import { referralSlotCatalog, slotCatalogQuery } from "../../utils/referral-slots";

export default defineEventHandler(async event => {
  const query = getQuery(event);
  const id = typeof query.id === "string" ? query.id.trim() : "";
  if (!isMemberId(id)) throw createError({ statusCode: 400, statusMessage: "Enter a valid numeric member ID." });
  const pagination = slotCatalogQuery(query);
  const member = await db().one<{ id: string; referral_code: string }>("SELECT id,referral_code FROM users WHERE referral_code = $1",id);
  if (!member) throw createError({ statusCode: 404, statusMessage: "No member was found with that ID." });
  return referralSlotCatalog(member,pagination);
});
