import { db } from "./database";

export async function updateUsername(userId: string, value: unknown) {
  const username = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username))
    throw createError({ statusCode: 400, statusMessage: "Use 3\u201324 letters, numbers, or underscores. Start with a letter." });
  try {
    const updated = await db().one<{ username: string }>("UPDATE users SET username = $1 WHERE id = $2 RETURNING username", username, userId);
    if (!updated) throw createError({ statusCode: 404, statusMessage: "That username was not found." });
    return updated.username;
  } catch (error) {
    const conflict = error as { code?: string; constraint?: string };
    if (conflict.code === "23505" && conflict.constraint === "users_username_unique")
      throw createError({ statusCode: 409, statusMessage: "That username is already taken." });
    throw error;
  }
}
