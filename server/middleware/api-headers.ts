export default defineEventHandler((event) => {
  if (!getRequestURL(event).pathname.startsWith("/api/")) return;
  setHeader(event, "Cache-Control", "no-store");
  setHeader(event, "X-Content-Type-Options", "nosniff");
  const size = Number(getHeader(event, "content-length") || 0);
  if (size > 8192) throw createError({ statusCode: 413, statusMessage: "Request is too large." });
});
