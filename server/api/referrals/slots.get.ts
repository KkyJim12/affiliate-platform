import { requireUser } from "../../utils/auth";
import { referralSlotCatalog, slotCatalogQuery } from "../../utils/referral-slots";

// The workspace always resolves ownership from the authenticated session.
export default defineEventHandler(async event => {
  const user = await requireUser(event);
  return referralSlotCatalog(user,slotCatalogQuery(getQuery(event)));
});
