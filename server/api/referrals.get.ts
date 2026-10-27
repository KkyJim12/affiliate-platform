import { requireUser } from "../utils/auth";
import { db } from "../utils/database";
import type { ReferralNetwork } from "../../shared/types";
export default defineEventHandler(async (event): Promise<ReferralNetwork> => {
    const user = await requireUser(event);
    const rows = await db().all("SELECT referral_code, created_at FROM users WHERE sponsor_id = $1 ORDER BY created_at DESC", user.id) as {
        referral_code: string;
        created_at: string;
    }[];
    const network = await db().all(`
    WITH RECURSIVE referral_network AS (
      SELECT id, referral_code, sponsor_id, created_at, 1 AS depth FROM users WHERE sponsor_id = $1
      UNION ALL
      SELECT child.id, child.referral_code, child.sponsor_id, child.created_at, parent.depth + 1
      FROM users AS child JOIN referral_network AS parent ON child.sponsor_id = parent.id
      WHERE parent.depth < 15
    )
    SELECT * FROM (SELECT * FROM referral_network LIMIT 501) AS limited ORDER BY depth, created_at, id
  `, user.id) as {
        id: string;
        referral_code: string;
        sponsor_id: string;
        created_at: string;
        depth: number;
    }[];
    return {
        members: rows.map((row) => ({ memberId: row.referral_code, joinedAt: row.created_at, status: "Registered" })),
        network: network.slice(0, 500).map((row) => ({ id: row.id, parentId: row.sponsor_id, memberId: row.referral_code, joinedAt: row.created_at, status: "Registered", depth: row.depth })),
        truncated: network.length > 500,
    };
});
