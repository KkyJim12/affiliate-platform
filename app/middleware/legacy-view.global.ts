export default defineNuxtRouteMiddleware(to => {
  if (to.path !== "/dashboard") return;
  const destinations: Record<string, string> = { matrix: "/dashboard", wallet: "/wallet", ranks: "/faq/ranks", rewards: "/faq/ranks", faq: "/faq", analytics: "/faq/analytics" };
  const target = destinations[String(to.query.view)];
  if (target) {
    const { view, ...query } = to.query;
    return navigateTo({ path: target, query }, { replace: true });
  }
});
