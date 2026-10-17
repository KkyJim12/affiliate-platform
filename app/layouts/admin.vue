<script setup lang="ts">
const { t } = useLoopI18n();
const { user, logout } = useAccount();
const { errorMessage } = useAdminTools();
const route = useRoute();
const sidebarOpen = ref(false);
const signingOut = ref(false);
const error = ref("");
const links = [
  { path: "/admin/dashboard", key: "dashboard", icon: "LayoutDashboard" },
  { path: "/admin/users", key: "users", icon: "Users" },
  { path: "/admin/explorer", key: "explorer", icon: "Globe" },
  { path: "/admin/payments", key: "payments", icon: "Wallet" },
  { path: "/admin/settings", key: "settings", icon: "Settings" },
] as const;
const active = computed(() => links.find(link => route.path === link.path || route.path === link.path.replace(/s$/, "")) || links[0]);
watch(() => route.fullPath, () => { sidebarOpen.value = false; });
async function signOut() {
  if (signingOut.value) return;
  signingOut.value = true;
  try { await logout(); await navigateTo("/admin/login"); }
  catch (failure) { error.value = errorMessage(failure); }
  finally { signingOut.value = false; }
}
</script>

<template>
  <div class="admin-app" @keydown.esc="sidebarOpen = false">
    <button v-if="sidebarOpen" class="admin-nav-overlay" :aria-label="t('admin.closeNavigation')" @click="sidebarOpen = false"></button>
    <aside class="admin-sidebar" :class="{ open: sidebarOpen }">
      <NuxtLink to="/admin/dashboard" class="admin-brand" aria-label="UNXO"><BrandLogo /></NuxtLink>
      <span class="admin-workspace-label">{{ t('admin.controlCenter') }}</span>
      <nav :aria-label="t('admin.navigation')">
        <NuxtLink v-for="link in links" :key="link.path" :to="link.path" :class="{ active: active.path === link.path }" :aria-current="active.path === link.path ? 'page' : undefined"><AppIcon :name="link.icon" :size="19" />{{ t(`admin.${link.key}`) }}<AppIcon name="ChevronRight" :size="14" /></NuxtLink>
      </nav>
      <div class="admin-sidebar-bottom">
        <div class="admin-access-card"><AppIcon name="ShieldCheck" :size="23" /><strong>{{ t('admin.adminAccess') }}</strong><p>{{ t('admin.accessDescription') }}</p></div>
        <NuxtLink to="/dashboard" class="admin-back-link"><AppIcon name="ArrowLeft" :size="17" />{{ t('admin.memberWorkspace') }}</NuxtLink>
        <button class="admin-back-link" :disabled="signingOut" @click="signOut"><AppIcon name="LogOut" :size="17" />{{ t('ui.sign_out') }}</button>
      </div>
    </aside>
    <div class="admin-main">
      <header class="admin-topbar"><div class="admin-breadcrumb"><button class="icon-button admin-menu" :aria-label="t('admin.openNavigation')" :aria-expanded="sidebarOpen" @click="sidebarOpen = !sidebarOpen"><AppIcon name="Menu" /></button><span>{{ t('admin.admin') }}</span><AppIcon name="ChevronRight" :size="13" /><strong>{{ t(`admin.${active.key}`) }}</strong></div><div class="admin-header-actions"><LocaleSwitcher /><ThemeToggle /><span class="admin-header-avatar" :title="user?.username">{{ user?.username.slice(0, 2).toUpperCase() }}</span></div></header>
      <div v-if="error" class="admin-shell-error auth-error" role="alert">{{ error }}</div>
      <slot />
      <footer class="admin-footer"><span><span class="green-dot"></span>{{ t('admin.liveData') }}</span><span>UNXO · {{ t('admin.controlCenter') }}</span></footer>
    </div>
  </div>
</template>
