<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

import { formatUsdt } from "#shared/plan";
import type { ReferralNode, ReferralNetwork } from "../../shared/types";

const route = useRoute();
const motionRoot = ref<HTMLElement | null>(null);
const { authOpen, copy, notify } = useAppUI();
const { user, authenticated, sessionError, logout } = useAccount();
const { wallet, refreshWallet } = useEvmWallet();
const { summary, dashboardError, refreshDashboard } = useDashboard();
const refreshing = ref(false);
const config = useRuntimeConfig();
const external = config.public.walletMode !== 'embedded';
const colorMode = useColorMode();
const { data: platform } = await useFetch<import("../../shared/admin").PlatformSettings>("/api/platform-settings");
const sidebarOpen = ref(false);
const faqOpen = ref(true);
const search = ref("");
const referralStatus = ref("all");
const members = ref<ReferralNode[]>([]);
const networkTruncated = ref(false);
const referralLayout = computed(() => route.query.layout === "list" ? "list" : route.query.layout === "unilevel" ? "unilevel" : "tree");
function setReferralLayout(layout: "list" | "tree" | "unilevel") {
  return navigateTo({ path: route.path, query: { ...route.query, layout } }, { replace: true });
}
const referralError = ref("");
const request = useRequestFetch();
const treeVersion = ref(0);
const preview = computed(() => !authenticated.value);
const currentView = computed(() => {
  if (route.path === "/faq/ranks") return "ranks";
  if (["/faq/analytics", "/analytics"].includes(route.path)) return "analytics";
  if (route.path === "/faq") return "faq";
  if (route.path === "/explorer") return "explorer";
  if (route.path === "/wallet") return "wallet";
  if (["/referrals", "/referral"].includes(route.path)) return "referrals";
  const view = String(route.query.view || "overview");
  return ["overview", "referrals", "explorer", "ranks", "settings", "faq", "analytics"].includes(view) ? view : view === "rewards" ? "ranks" : "overview";
});
usePageMotion(motionRoot, currentView);
const navigation = [
  { view: "overview", label: "Overview", icon: "LayoutDashboard" },
  { view: "referrals", label: "My referrals", icon: "Users" },
  { view: "explorer", label: "Explorer", icon: "Globe" },
  { view: "search", label: "Search by ID", icon: "Search" },
  { view: "wallet", label: "EVM wallet", icon: "Wallet" },
  { view: "faq", label: "FAQs", icon: "HelpCircle" },
  { view: "settings", label: "Account settings", icon: "Settings" },
] as const;
const titles: Record<string, string> = { overview: "Your network, at a glance.", referrals: "Good people. Growing together.", ranks: "Referral levels & commissions.", wallet: "Your EVM wallet.", settings: "Your little corner of Loop." };
const subtitles: Record<string, string> = { overview: "Your matrix, commissions, and wallet. All connected.", referrals: "Your personal invites and 15 levels of referral commissions.", ranks: "Purchase prices, upgrade rules, and payouts from each referral purchase.", wallet: "Your EVM address, balances, and keys.", settings: "Your account, invite code, and security in one place." };
const viewLabel = computed(() => currentView.value === 'analytics' ? t('workspace.analytics') : currentView.value === 'faq' ? t('workspace.faq') : currentView.value === 'ranks' ? t('ui.ranks_commissions') : currentView.value === 'wallet' ? t('evmWallet.title') : tr(navigation.find(item => item.view === currentView.value)?.label));
const viewHeading = computed(() => currentView.value === 'faq' ? t('workspace.faqTitle') : currentView.value === 'analytics' ? t('workspace.analyticsTitle') : currentView.value === 'explorer' ? t('explorer.heading') : currentView.value === 'wallet' ? t('evmWallet.heading') : tr(titles[currentView.value]));
const viewDescription = computed(() => currentView.value === 'faq' ? t('workspace.faqHint') : currentView.value === 'analytics' ? t('workspace.analyticsHint') : currentView.value === 'explorer' ? t('workspace.contractScope') : currentView.value === 'overview' ? t('workspace.overviewHint') : currentView.value === 'wallet' ? t(external ? 'connected.walletHint' : 'evmWallet.subtitle') : tr(subtitles[currentView.value]));
function destination(view: string) { return ({ overview: '/dashboard', referrals: '/referrals', explorer: '/explorer', search: '/search', wallet: '/wallet', faq: '/faq' } as Record<string,string>)[view] || '/dashboard?view=' + view; }
useHead({ title: computed(() => viewLabel.value + ' - UNXO') });
const origin = useRequestURL().origin;
const referralLink = computed(() => `${String(config.public.appUrl || origin).replace(/\/$/, "")}/referrals?ref=${user.value?.referralCode || ""}`);
const sampleMembers: ReferralNode[] = Array.from({ length: 8 }, (_, index) => String(1001 + index)).map((memberId, index) => ({
  id: `preview-member-${index}`,
  parentId: index < 2 ? "preview-root" : `preview-member-${[0, 0, 0, 0, 1, 1, 2, 2][index]}`,
  depth: index < 2 ? 1 : index < 6 ? 2 : 3,
  memberId, joinedAt: `2026-10-${String(17 - index).padStart(2, "0")}T12:00:00Z`, status: index === 2 || index === 5 ? "Registered" : "Qualified",
}));
const referralMembers = computed(() => preview.value ? sampleMembers : members.value);
const visibleMembers = computed(() => referralMembers.value.filter((item) => item.memberId.toLowerCase().includes(search.value.toLowerCase()) && (referralStatus.value === "all" || item.status === referralStatus.value)));
const displayDate = useState('display-date', () => new Date().toISOString());
const dateLabel = computed(() => formatDate(displayDate.value, { month: 'long', day: 'numeric', year: 'numeric' }));


watch(currentView, () => { sidebarOpen.value = false; if (["faq", "ranks", "analytics"].includes(currentView.value)) faqOpen.value = true; });
watch(() => user.value?.id, async () => { await loadReferrals(); });
async function loadReferrals() {
  members.value = [];
  networkTruncated.value = false;
  referralError.value = "";
  if (!user.value) return;
  const accountId = user.value.id;
  try {
    const result = await request<ReferralNetwork>("/api/referrals");
    if (user.value?.id === accountId) {
      members.value = result.network;
      networkTruncated.value = result.truncated;
    }
  }
  catch { if (user.value?.id === accountId) referralError.value = "Your referrals could not be loaded. Please try again."; }
}
await loadReferrals();
if (authenticated.value && !summary.value) await refreshDashboard();

async function refreshActivity() {
  if (refreshing.value) return;
  refreshing.value = true;
  try { await Promise.all([refreshWallet(), refreshDashboard(), loadReferrals()]); treeVersion.value++; }
  finally { refreshing.value = false; }
}
async function referralsUpdated() { await Promise.all([loadReferrals(), refreshDashboard()]); treeVersion.value++; }

function invite() { if (preview.value) authOpen.value = true; else if (!user.value?.referralCode) navigateTo("/referrals"); else copy(referralLink.value, "Your invite link is ready to share."); }
async function signOut() { try { await logout(); } catch { notify("We could not sign you out. Please try again."); } }
function exportReferrals() {
  const csv = [t('ui.member_id_joined_status_referral_level'), ...visibleMembers.value.map((item) => `${item.memberId},${item.joinedAt},${tr(item.status)},${item.depth}`)].join("\r\n");
  const url = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }));
  const link = document.createElement("a"); link.href = url; link.download = "loop-referrals.csv"; link.click(); URL.revokeObjectURL(url);
}
</script>

<template>
  <div class="dashboard-shell matrix-dashboard">
    <div v-if="sidebarOpen" class="sidebar-backdrop" @click="sidebarOpen = false"></div>
    <aside class="dashboard-sidebar" :class="{ 'sidebar-open': sidebarOpen }">
      <NuxtLink to="/" class="sidebar-logo" :aria-label="t('ui.loop_home')"><BrandLogo /></NuxtLink>
      <div class="workspace-label">{{ t('ui.your_workspace') }}</div>
      <nav class="sidebar-nav" :aria-label="t('ui.dashboard_navigation')">
        <template v-for="item in navigation" :key="item.view">
          <hr v-if="item.view === 'faq'" class="sidebar-nav-divider" />
          <div v-if="item.view === 'faq'" class="faq-nav-group">
            <div class="faq-nav-heading" :class="{ active: ['faq','ranks','analytics'].includes(currentView) }"><NuxtLink to="/faq" :aria-current="currentView === 'faq' ? 'page' : undefined"><AppIcon name="HelpCircle" :size="19" />{{ t('workspace.faq') }}</NuxtLink><button :aria-label="t('workspace.faqMenu')" :aria-expanded="faqOpen" aria-controls="faq-subnav" @click="faqOpen = !faqOpen"><AppIcon name="ChevronDown" :size="15" /></button></div>
            <nav v-if="faqOpen" id="faq-subnav" class="faq-subnav" :aria-label="t('workspace.faqMenu')"><NuxtLink to="/faq/ranks" :class="{ active: currentView === 'ranks' }" :aria-current="currentView === 'ranks' ? 'page' : undefined"><AppIcon name="Layers" :size="15" />{{ t('ui.ranks_commissions') }}</NuxtLink><NuxtLink to="/faq/analytics" :class="{ active: currentView === 'analytics' }" :aria-current="currentView === 'analytics' ? 'page' : undefined"><AppIcon name="TrendingUp" :size="15" />{{ t('workspace.analytics') }}</NuxtLink></nav>
          </div>
          <NuxtLink v-else :to="destination(item.view)" :class="{ active: currentView === item.view }" :aria-current="currentView === item.view ? 'page' : undefined"><AppIcon :name="item.icon" :size="19" />{{ item.view === 'search' ? t('publicTree.nav') : item.view === 'wallet' ? t('evmWallet.title') : tr(item.label) }}<span v-if="item.view === 'referrals'" class="nav-count">{{ preview ? 8 : members.length }}</span></NuxtLink>
        </template>
      </nav>
      <div class="sidebar-bottom">
        <NuxtLink v-if="user?.role === 'admin'" to="/admin/dashboard" class="sidebar-help"><AppIcon name="ShieldCheck" :size="17" />{{ t('admin.controlCenter') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink>
        <div class="sidebar-invite"><span class="sidebar-spark">✳</span><strong>{{ t('ui.a_good_connection') }}<br />{{ t('ui.goes_a_long_way') }}</strong><p>{{ t('ui.your_people_your_growing_loop') }}</p><button @click="invite">{{ preview ? t('ui.create_your_account') : t('ui.invite_a_friend') }}<AppIcon name="ArrowUpRight" :size="16" /></button></div>
        <NuxtLink to="/#faq" class="sidebar-help"><AppIcon name="HelpCircle" :size="17" />{{ t('ui.need_a_little_help') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink>
        <div class="sidebar-network"><span class="green-dot"></span>{{ t(external ? 'connected.walletTitle' : 'ui.in_app_usdt_wallet') }}<span>{{ t('ui.included') }}</span></div>
      </div>
    </aside>
    <div class="dashboard-main">
      <header class="dashboard-topbar">
        <div class="breadcrumbs"><button class="icon-button dashboard-menu" :aria-label="t('ui.open_navigation')" @click="sidebarOpen = !sidebarOpen"><AppIcon name="Menu" /></button><span>{{ t('ui.workspace') }}</span><AppIcon name="ChevronRight" :size="13" /><strong>{{ viewLabel }}</strong></div>
        <div class="topbar-actions"><LocaleSwitcher /><ThemeToggle /><span v-if="preview" class="demo-badge">{{ t('ui.plan_preview') }}</span><button v-if="!authenticated" class="topbar-wallet" @click="authOpen = true"><AppIcon name="LockKeyhole" :size="15" />{{ t('ui.sign_in') }}</button><ProfileMenu v-if="user" /><span v-else class="profile-avatar">LP</span></div>
      </header>
      <main ref="motionRoot" class="dashboard-content">
        <p v-if="sessionError" class="auth-error" role="alert">{{ tr(sessionError) }}</p>
        <div class="dashboard-heading"><div><div class="dashboard-greeting">{{ user ? t('ui.welcome_back_p0', { p0: user.memberId.toUpperCase() }) : t('ui.a_little_connection_goes_a_long_way') }}<span>✦</span></div><h1>{{ viewHeading }}</h1><p>{{ viewDescription }}</p></div><span class="dashboard-date"><AppIcon name="CalendarDays" :size="16" />{{ dateLabel }}</span></div>

        <section v-if="currentView === 'overview'" class="overview-banner"><div><span class="eyebrow">{{ t('ui.built_around_your_connections') }}</span><h2>{{ t('workspace.overviewTitle') }}</h2><p>{{ t('workspace.networkHint') }}</p></div><button class="button button-orange" @click="invite"><AppIcon name="Link" :size="16" />{{ preview ? t('ui.create_your_loop') : t('ui.copy_invite_link') }}</button></section>

        <div v-if="currentView === 'overview' && !preview" class="dashboard-activity-bar"><span>{{ t('dashboard.accountActivity') }}</span><button class="text-action" :disabled="refreshing" @click="refreshActivity"><AppIcon name="RefreshCw" :size="14" />{{ refreshing ? t('ui.please_wait') : t('admin.refresh') }}</button></div>
        <p v-if="currentView === 'overview' && dashboardError && !preview" class="auth-error" role="alert">{{ tr(dashboardError) }}</p>
        <div v-if="currentView === 'overview' && !preview" class="network-stat-grid" data-testid="account-overview">
          <article class="network-stat"><span class="stat-icon peach-icon"><AppIcon name="CircleDollarSign" :size="19" /></span><div><p>{{ t('ui.total_commissions_credited') }}</p><strong data-testid="overview-commissions">{{ summary ? formatUsdt(summary.commissions) : '—' }}<small>USDT</small></strong><span>{{ t('ui.completed_credits_to_your_wallet') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon green-icon"><AppIcon name="Users" :size="19" /></span><div><p>{{ t('dashboard.directReferrals') }}</p><strong data-testid="overview-direct-referrals">{{ summary?.referrals.direct ?? '—' }}</strong><span>{{ t('dashboard.directHint') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon lavender-icon"><AppIcon name="GitFork" :size="19" /></span><div><p>{{ t('dashboard.networkMembers') }}</p><strong data-testid="overview-network-members">{{ summary?.referrals.total ?? '—' }}{{ summary?.referrals.truncated ? '+' : '' }}</strong><span>{{ t('dashboard.networkHint') }}</span></div></article>
        </div>
        <div v-else-if="currentView === 'overview'" class="network-stat-grid">
          <article class="network-stat"><span class="stat-icon green-icon"><AppIcon name="Users" :size="19" /></span><div><p>{{ t('dashboard.directReferrals') }}</p><strong>{{ sampleMembers.filter(member => member.depth === 1).length }}</strong><span>{{ t('ui.sample_data') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon lavender-icon"><AppIcon name="GitFork" :size="19" /></span><div><p>{{ t('dashboard.networkMembers') }}</p><strong>{{ sampleMembers.length }}</strong><span>{{ t('ui.sample_data') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon peach-icon"><AppIcon name="Layers" :size="19" /></span><div><p>{{ t('ui.referral_level') }}</p><strong>{{ Math.max(...sampleMembers.map(member => member.depth)) }}</strong><span>{{ t('ui.sample_data') }}</span></div></article>
        </div>

        <div v-if="currentView === 'overview'" class="matrix-overview-grid overview-network-grid">
          <section class="panel overview-tree-panel" data-testid="overview-referral-tree"><div class="section-card-header"><div><h2>{{ t('workspace.networkTitle') }}<span v-if="preview" class="sample-label">{{ t('ui.sample_data') }}</span></h2><p>{{ t('workspace.networkHint') }}</p></div><NuxtLink to="/referrals?layout=tree" class="inline-link">{{ t('workspace.fullTree') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink></div><p v-if="referralError" class="auth-error" role="alert">{{ tr(referralError) }}</p><BinaryReferralTree v-if="user?.memberId" :key="`overview-${user.memberId}-${treeVersion}`" :member-id="user.memberId" /><ReferralTree v-else :members="referralMembers" :root-id="user?.id || 'preview-root'" :memberId="user?.memberId || '1000'" :matching-ids="referralMembers.map(member => member.id)" :filtered="false" /></section>
          <div class="overview-wallet-column"><WalletPanel compact :preview="preview" /></div>
        </div>

        <section v-if="currentView === 'overview'" class="panel distribution-panel"><div class="section-card-header"><div><h2>{{ t('ui.a_little_clarity_on_your_commissions') }}</h2><p>{{ t('ui.one_qualifying_payment_distributed_across_the_plan') }}</p></div><NuxtLink to="/faq/ranks" class="inline-link">{{ t('ui.explore_all_ranks') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink></div><div class="distribution-bar" :aria-label="t('ui.80_percent_binary_matrix_15_percent_unilevel_5_percent_system')"><span></span><span></span><span></span></div><div class="distribution-labels"><span><i></i><strong>80%</strong> {{ t('referral.directShare') }}</span><span><i></i><strong>15%</strong> {{ t('ui.unilevel_1_15') }}</span><span><i></i><strong>5%</strong> {{ t('ui.system') }}</span></div></section>

        <template v-if="currentView === 'referrals'">
          <ReferralAccess :key="user?.id || 'preview'" :preview="preview" @updated="referralsUpdated" />
          <section class="panel member-panel">
            <div class="section-card-header"><div><h2>{{ t(!preview && referralLayout === 'tree' ? 'matrixSlots.title' : 'ui.your_referral_network') }}<span v-if="preview || referralLayout === 'list'" class="sample-label">{{ preview ? t('ui.sample_data') : members.length + " " + t('ui.members') }}</span></h2><p>{{ t(!preview && referralLayout === 'tree' ? 'matrixSlots.hint' : 'ui.your_invites_and_the_connections_growing_from_them') }}</p></div><button v-if="preview || referralLayout === 'list'" class="button button-outline button-small" @click="exportReferrals"><AppIcon name="Download" :size="15" />{{ t('ui.export_csv') }}</button></div>
            <div class="referral-view-bar"><span>{{ t('ui.see_your_connections_your_way') }}</span><div class="referral-view-toggle" role="group" :aria-label="t('ui.referral_view')"><button :aria-pressed="referralLayout === 'tree'" :class="{ selected: referralLayout === 'tree' }" @click="setReferralLayout('tree')"><AppIcon :name="preview ? 'GitFork' : 'Layers'" :size="16" />{{ t(preview ? 'ui.tree_view' : 'matrixSlots.nav') }}</button><button v-if="!preview" :aria-pressed="referralLayout === 'unilevel'" :class="{ selected: referralLayout === 'unilevel' }" @click="setReferralLayout('unilevel')"><AppIcon name="GitFork" :size="16" />{{ t('matrix.unilevel') }}</button><button :aria-pressed="referralLayout === 'list'" :class="{ selected: referralLayout === 'list' }" @click="setReferralLayout('list')"><AppIcon name="List" :size="16" />{{ t('ui.list_view') }}</button></div></div>
            <div v-if="referralLayout === 'list' || preview" class="member-tools"><label class="search-field"><AppIcon name="Search" :size="17" /><input v-model="search" :aria-label="t('ui.search_referrals')" :placeholder="t('ui.search_by_username')" /></label><AppDropdown v-model="referralStatus" :label="t('ui.filter_referral_status')" :options="[{ value: 'all', label: t('ui.all_statuses') }, { value: 'Registered', label: t('ui.registered') }, ...(preview ? [{ value: 'Qualified', label: t('ui.qualified') }] : [])]" /></div>
            <p v-if="referralError" class="form-error" role="alert">{{ tr(referralError) }}</p>
            <MatrixSlots v-if="referralLayout === 'tree' && user?.memberId" :key="`referrals-${user.memberId}-${treeVersion}`" :member-id="user.memberId" /><BinaryReferralTree v-else-if="referralLayout === 'unilevel' && user?.memberId" :key="`unilevel-${user.memberId}-${treeVersion}`" :member-id="user.memberId" initial-mode="unilevel" fixed-program live /><ReferralTree v-else-if="referralLayout === 'tree'" :members="referralMembers" :root-id="user?.id || 'preview-root'" :memberId="user?.memberId || '1000'" :matching-ids="visibleMembers.map((member) => member.id)" :filtered="!!search || referralStatus !== 'all'" />
            <div v-else class="table-scroll"><table><thead><tr><th>{{ t('ui.member') }}</th><th>{{ t('ui.date_joined') }}</th><th>{{ t('ui.status') }}</th><th>{{ t('ui.referral_level') }}</th></tr></thead><tbody><tr v-for="(member, index) in visibleMembers" :key="member.id"><td><div class="member-identity"><span class="table-avatar" :class="`avatar-${['peach', 'lavender', 'green', 'blue'][index % 4]}`">{{ member.memberId.slice(0, 2).toUpperCase() }}</span><strong>ID {{ member.memberId }}</strong></div></td><td>{{ formatDate(member.joinedAt) }}</td><td><span class="member-status" :class="{ qualified: member.status === 'Qualified' }"><i></i>{{ tr(member.status) }}</span></td><td>{{ t('ui.level') }} {{ member.depth }}{{ member.depth === 1 ? " " + t('ui.direct') : '' }}</td></tr><tr v-if="!visibleMembers.length"><td colspan="4" class="empty-state"><AppIcon name="Users" :size="27" /><strong>{{ search || referralStatus !== 'all' ? t('ui.no_matching_referrals') : t('ui.your_circle_starts_here') }}</strong><span>{{ search || referralStatus !== 'all' ? t('ui.try_another_search_or_status') : t('ui.share_your_invite_link_to_bring_someone_into_your_loop') }}</span></td></tr></tbody></table></div>
            <div v-if="referralLayout === 'list' || preview" class="member-table-foot">{{ visibleMembers.length }} {{ preview ? tr('sample') : tr('network') }} {{ t('ui.members_f13eb') }}{{ networkTruncated ? " " + t('ui.showing_the_first_500_members_8ad45') : '' }} {{ t('ui.up_to_15_referral_levels_179fe') }}</div>
          </section>
        </template>

        <ReferralRanks v-if="currentView === 'ranks'" />
        <PlatformFaq v-if="currentView === 'faq'" />
        <PlatformAnalytics v-if="currentView === 'analytics'" />

        <PlatformExplorer v-if="currentView === 'explorer'" :key="user?.id || 'preview'" :preview="preview" :preview-members="sampleMembers" />

        <template v-if="currentView === 'wallet'">
          <WalletPanel :preview="preview" />
          <WalletTransactions :preview="preview" />
        </template>

        <section v-if="currentView === 'settings'" class="panel account-settings"><div class="section-card-header"><div><h2>{{ t('ui.account_details') }}</h2><p>{{ t('ui.your_identity_and_wallet_connected') }}</p></div><AppIcon name="ShieldCheck" :size="24" /></div><div class="account-settings-row"><div><strong>{{ tr('Language') }}</strong><p>{{ tr('Preferred language') }}</p></div><LocaleSwitcher /></div><div class="account-settings-row"><div><strong>{{ t('ui.appearance') }}</strong><p>{{ t('ui.a_gold_workspace_in_your_preferred_light') }}</p></div><ClientOnly><AppDropdown v-model="colorMode.preference" class="theme-preference-dropdown" :label="t('ui.theme_preference')" :options="[{ value: 'light', label: t('ui.light_theme') }, { value: 'dark', label: t('ui.dark_theme') }]" /><template #fallback><span class="settings-tag">{{ t('ui.appearance') }}</span></template></ClientOnly></div><div class="account-settings-row"><div><strong>{{ t('evmWallet.title') }}</strong><p>{{ wallet?.address || t(external ? 'connected.linkHint' : 'ui.automatically_created_with_your_account') }}</p></div><NuxtLink class="button button-outline button-small" to="/wallet">{{ t('ui.open_wallet') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink></div><div v-if="user?.memberId" class="account-settings-row"><div><strong>{{ t('publicTree.memberId') }}</strong><p data-testid="account-member-id">{{ user.memberId }}</p></div><NuxtLink class="text-action" :to="{ path: '/search', query: { id: user.memberId } }">{{ t('publicTree.search') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink></div><div class="account-settings-row"><div><strong>{{ t('ui.personal_invite_code') }}</strong><p>{{ user?.referralCode || t('referral.lockedSetting') }}</p></div><button class="text-action" @click="invite"><AppIcon name="Copy" :size="15" />{{ user?.referralCode ? t('ui.copy_invite') : t('referral.manageAccess') }}</button></div><div class="account-settings-row"><div><strong>{{ t('ui.invited_by') }}</strong><p>{{ user?.sponsorCode || t('ui.no_sponsor_code_applied') }}</p></div><AppIcon name="Users" :size="20" /></div><div class="account-settings-row"><div><strong>{{ t('ui.session_security') }}</strong><p>{{ user ? t('ui.your_session_stays_signed_in_for_up_to_7_days') : t(external ? 'connected.signInHint' : 'ui.sign_in_with_your_username_and_password') }}</p></div><button class="button button-outline button-small" @click="user ? signOut() : (authOpen = true)"><AppIcon :name="user ? 'LogOut' : 'LockKeyhole'" :size="16" />{{ user ? t('ui.sign_out') : t('ui.sign_in') }}</button></div></section>

        <footer class="dashboard-footer"><a v-if="platform?.supportEmail" :href="'mailto:' + platform.supportEmail">{{ t('admin.supportEmail') }}</a><span><BrandLogo />{{ t('ui.good_connections_come_full_circle') }}</span><span>{{ preview ? t('ui.illustrative_plan_preview_sample_figures') : t(external ? 'connected.walletTitle' : 'ui.loop_account_in_app_usdt_ledger') }}<span class="green-dot"></span></span></footer>
      </main>
    </div>
  </div>
</template>
