import { assertSameOrigin, rateLimit, requireAdmin } from "../../utils/auth";
import { db, transaction } from "../../utils/database";
import { audit, platformSettings } from "../../utils/admin";
import { getAddress, isAddress } from "viem";
import { referralPaymentMode } from "../../utils/referral-chain";
export default defineEventHandler(async (event) => {
    assertSameOrigin(event);
    const admin = await requireAdmin(event);
    await rateLimit(event, `admin-settings:${admin.id}`, 30);
    const body = await readBody(event);
    const supportEmail = typeof body?.supportEmail === "string" ? body.supportEmail.trim() : null;
    const address = typeof body?.feeRecipientAddress === "string" ? body.feeRecipientAddress.trim() : "";
    if (address && (!isAddress(address) || /^0x0{40}$/i.test(address)))
        throw createError({ statusCode: 400, statusMessage: "Enter a valid, nonzero EVM platform fee address." });
    if (body?.feeRecipientAddress !== undefined && typeof body.feeRecipientAddress !== "string")
        throw createError({ statusCode: 400, statusMessage: "Enter a valid, nonzero EVM platform fee address." });
    if (typeof body?.registrationOpen !== "boolean" || typeof body?.fundingOpen !== "boolean" || supportEmail === null || supportEmail.length > 254 || (supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)))
        throw createError({ statusCode: 400, statusMessage: "Enter valid platform settings and a valid support email." });
    await transaction(async () => {
        await db().execute("SELECT id FROM platform_settings WHERE id = 1 FOR UPDATE");
        const current = await platformSettings();
        const feeAddress = body?.feeRecipientAddress === undefined ? current.feeRecipientAddress : address ? getAddress(address) : "";
        if (referralPaymentMode() === "contract" && feeAddress !== current.feeRecipientAddress)
            throw createError({ statusCode: 409, statusMessage: "Use the smart contract fee address control to update the on-chain recipient." });
        await db().execute("UPDATE platform_settings SET registration_open = $1, funding_open = $2, support_email = $3, fee_recipient_address = $4 WHERE id = 1", Number(body.registrationOpen), Number(body.fundingOpen), supportEmail, feeAddress);
        if (feeAddress !== current.feeRecipientAddress)
            await audit(admin.id, "fee_address_updated", `${current.feeRecipientAddress || 'unset'} → ${feeAddress || 'unset'}`);
        await audit(admin.id, "settings_updated", "platform");
    });
    return await platformSettings();
});
