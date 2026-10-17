export default defineNuxtRouteMiddleware(to => {
  if (useAccount().user.value?.role !== "admin") {
    return navigateTo({ path: "/admin/login", query: { redirect: to.fullPath } });
  }
});
