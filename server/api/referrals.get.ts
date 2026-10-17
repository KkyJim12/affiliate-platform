import { requireUser } from "../utils/auth";
import { db } from "../utils/database";
import type { ReferralNetwork } from "../../shared/types";

export default defineEventHandler((event): ReferralNetwork => {
  const user = requireUser(event);
  const rows = db().prepare("SELECT username, created_at FROM users WHERE sponsor_id = ? ORDER BY created_at DESC").all(user.id) as { username: string; created_at: string }[];
  const network = db().prepare(`
    WITH RECURSIVE referral_network AS (
      SELECT id, username, sponsor_id, created_at, 1 AS depth FROM users WHERE sponsor_id = ?
      UNION ALL
      SELECT child.id, child.username, child.sponsor_id, child.created_at, parent.depth + 1
      FROM users AS child JOIN referral_network AS parent ON child.sponsor_id = parent.id
      WHERE parent.depth < 15
      LIMIT 501
    )
    SELECT * FROM referral_network ORDER BY depth, created_at, id
  `).all(user.id) as { id: string; username: string; sponsor_id: string; created_at: string; depth: number }[];
  return {
    members: rows.map((row) => ({ username: row.username, joinedAt: row.created_at, status: "Registered" })),
    network: network.slice(0, 500).map((row) => ({ id: row.id, parentId: row.sponsor_id, username: row.username, joinedAt: row.created_at, status: "Registered", depth: row.depth })),
    truncated: network.length > 500,
  };
});
