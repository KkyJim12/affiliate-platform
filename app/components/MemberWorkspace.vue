<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

import { ranks, matrixRates, unilevelProjection, formatUsdt } from "#shared/plan";
import type { ReferralNode, ReferralNetwork } from "../../shared/types";

const route = useRoute();
const motionRoot = ref<HTMLElement | null>(null);
const { authOpen, copy, notify } = useAppUI();
const { user, authenticated, sessionError, logout } = useAccount();
const { wallet, refreshWallet } = useWallet();
const { summary, dashboardError, refreshDashboard } = useDashboard();
const refreshing = ref(false);
const config = useRuntimeConfig();
const colorMode = useColorMode();
const { data: platform } = await useFetch<import("../../shared/admin").PlatformSettings>("/api/platform-settings");
const sidebarOpen = ref(false);
const selectedRank = ref(3);
const search = ref("");
const referralStatus = ref("all");
const members = ref<ReferralNode[]>([]);
const networkTruncated = ref(false);
const referralLayout = computed(() => route.query.layout === "tree" ? "tree" : "list");
function setReferralLayout(layout: "list" | "tree") {
  return navigateTo({ path: route.path, query: { ...route.query, layout: layout === "tree" ? "tree" : undefined } }, { replace: true });
}
const referralError = ref("");
const request = useRequestFetch();
const activeRank = computed(() => ranks[selectedRank.value - 1]!);
const preview = computed(() => !authenticated.value);
const currentView = computed(() => {
  if (route.path === "/explorer") return "explorer";
  if (["/referrals", "/referral"].includes(route.path)) return "referrals";
  const view = String(route.query.view || "overview");
  return ["overview", "matrix", "referrals", "explorer", "ranks", "wallet", "settings"].includes(view) ? view : view === "rewards" ? "ranks" : "overview";
});
usePageMotion(motionRoot, currentView);
const navigation = [
  { view: "overview", label: "Overview", icon: "LayoutDashboard" },
  { view: "matrix", label: "My matrix", icon: "GitFork" },
  { view: "referrals", label: "My referrals", icon: "Users" },
  { view: "explorer", label: "Explorer", icon: "Globe" },
  { view: "ranks", label: "Ranks & commissions", icon: "Layers" },
  { view: "wallet", label: "In-app wallet", icon: "Wallet" },
  { view: "settings", label: "Account settings", icon: "Settings" },
] as const;
const titles: Record<string, string> = { overview: "Your network, at a glance.", matrix: "Every connection has a place.", referrals: "Good people. Growing together.", ranks: "A clearer view of every rank.", wallet: "Your rewards, right at home.", settings: "Your little corner of Loop." };
const subtitles: Record<string, string> = { overview: "Your matrix, commissions, and wallet. All connected.", matrix: "A binary structure. Three layers. Fourteen positions.", referrals: "Your personal invites and 15 levels of referral commissions.", ranks: "Explore the 15 ranks and the maths behind each one.", wallet: "Manage your USDT balance and follow every transaction.", settings: "Your account, invite code, and security in one place." };
useHead({ title: computed(() => `${tr(navigation.find((item) => item.view === currentView.value)?.label)} — UNXO`) });
const origin = useRequestURL().origin;
const referralLink = computed(() => `${String(config.public.appUrl || origin).replace(/\/$/, "")}/referrals?ref=${user.value?.referralCode || ""}`);
const projections = computed(() => unilevelProjection(selectedRank.value));
const sampleMembers: ReferralNode[] = ["alex_morgan", "jamie_chen", "taylor_kim", "sam_wilson", "jordan_lee", "riley_park", "casey_brooks", "drew_miller"].map((username, index) => ({
  id: `preview-member-${index}`,
  parentId: index < 2 ? "preview-root" : `preview-member-${[0, 0, 0, 0, 1, 1, 2, 2][index]}`,
  depth: index < 2 ? 1 : index < 6 ? 2 : 3,
  username, joinedAt: `2026-10-${String(17 - index).padStart(2, "0")}T12:00:00Z`, status: index === 2 || index === 5 ? "Registered" : "Qualified",
}));
const referralMembers = computed(() => preview.value ? sampleMembers : members.value);
const visibleMembers = computed(() => referralMembers.value.filter((item) => item.username.toLowerCase().includes(search.value.toLowerCase()) && (referralStatus.value === "all" || item.status === referralStatus.value)));
const displayDate = useState('display-date', () => new Date().toISOString());
const dateLabel = computed(() => formatDate(displayDate.value, { month: 'long', day: 'numeric', year: 'numeric' }));
const counts = computed(() => preview.value ? [2, 4, 5] : [0, 0, 0]);
const matrixGross = computed(() => counts.value.reduce((sum, count, depth) => sum + count * activeRank.value.price * matrixRates[depth]!, 0));
watch(currentView, () => { sidebarOpen.value = false; });
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
  try { await Promise.all([refreshWallet(), refreshDashboard(), loadReferrals()]); }
  finally { refreshing.value = false; }
}
async function referralsUpdated() { await Promise.all([loadReferrals(), refreshDashboard()]); }

function invite() { if (preview.value) authOpen.value = true; else if (!user.value?.referralCode) navigateTo("/referrals"); else copy(referralLink.value, "Your invite link is ready to share."); }
async function signOut() { try { await logout(); } catch { notify("We could not sign you out. Please try again."); } }
function exportReferrals() {
  const csv = [tr("Username,Joined,Status,Referral level"), ...visibleMembers.value.map((item) => `${item.username},${item.joinedAt},${tr(item.status)},${item.depth}`)].join("\r\n");
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
        <NuxtLink v-for="item in navigation" :key="item.view" :to="item.view === 'explorer' ? '/explorer' : item.view === 'referrals' ? '/referrals' : item.view === 'overview' ? '/dashboard' : `/dashboard?view=${item.view}`" :class="{ active: currentView === item.view }" :aria-current="currentView === item.view ? 'page' : undefined"><AppIcon :name="item.icon" :size="19" />{{ tr(item.label) }}<span v-if="item.view === 'referrals'" class="nav-count">{{ preview ? 8 : members.length }}</span></NuxtLink>
      </nav>
      <div class="sidebar-bottom">
        <NuxtLink v-if="user?.role === 'admin'" to="/admin/dashboard" class="sidebar-help"><AppIcon name="ShieldCheck" :size="17" />{{ t('admin.controlCenter') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink>
        <div class="sidebar-invite"><span class="sidebar-spark">✳</span><strong>{{ t('ui.a_good_connection') }}<br />{{ t('ui.goes_a_long_way') }}</strong><p>{{ t('ui.your_people_your_growing_loop') }}</p><button @click="invite">{{ preview ? t('ui.create_your_account') : t('ui.invite_a_friend') }}<AppIcon name="ArrowUpRight" :size="16" /></button></div>
        <NuxtLink to="/#faq" class="sidebar-help"><AppIcon name="HelpCircle" :size="17" />{{ t('ui.need_a_little_help') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink>
        <div class="sidebar-network"><span class="green-dot"></span>{{ t('ui.in_app_usdt_wallet') }}<span>{{ t('ui.included') }}</span></div>
      </div>
    </aside>
    <div class="dashboard-main">
      <header class="dashboard-topbar">
        <div class="breadcrumbs"><button class="icon-button dashboard-menu" :aria-label="t('ui.open_navigation')" @click="sidebarOpen = !sidebarOpen"><AppIcon name="Menu" /></button><span>{{ t('ui.workspace') }}</span><AppIcon name="ChevronRight" :size="13" /><strong>{{ tr(navigation.find((item) => item.view === currentView)?.label) }}</strong></div>
        <div class="topbar-actions"><LocaleSwitcher /><ThemeToggle /><span v-if="preview" class="demo-badge">{{ t('ui.plan_preview') }}</span><NuxtLink v-if="authenticated" class="topbar-wallet" to="/dashboard?view=wallet"><UsdtIcon />{{ formatUsdt(wallet?.available || 0) }}<span>USDT</span></NuxtLink><button v-else class="topbar-wallet" @click="authOpen = true"><AppIcon name="LockKeyhole" :size="15" />{{ t('ui.sign_in') }}</button><ProfileMenu v-if="user" /><span v-else class="profile-avatar">LP</span></div>
      </header>
      <main ref="motionRoot" class="dashboard-content">
        <p v-if="sessionError" class="auth-error" role="alert">{{ tr(sessionError) }}</p>
        <div class="dashboard-heading"><div><div class="dashboard-greeting">{{ user ? t('ui.welcome_back_p0', { p0: user.username.toUpperCase() }) : t('ui.a_little_connection_goes_a_long_way') }}<span>✦</span></div><h1>{{ currentView === 'explorer' ? t('explorer.heading') : tr(titles[currentView]) }}</h1><p>{{ currentView === 'explorer' ? t('explorer.memberSubtitle') : tr(subtitles[currentView]) }}</p></div><span class="dashboard-date"><AppIcon name="CalendarDays" :size="16" />{{ dateLabel }}</span></div>

        <section v-if="currentView === 'overview'" class="network-banner"><div><span class="banner-eyebrow">{{ t('ui.built_around_your_connections') }}</span><h2>{{ t('ui.three_layers') }}<br />{{ t('ui.one_growing_loop') }}</h2><p>{{ t('ui.a_3_layer_binary_matrix_15_referral_levels') }}<br class="desktop-break" /> {{ t('ui.and_a_wallet_that_keeps_it_all_together') }}</p><button class="button button-white" @click="invite"><AppIcon name="Link" :size="16" />{{ preview ? t('ui.create_your_loop') : t('ui.copy_invite_link') }}<AppIcon name="ArrowUpRight" :size="16" /></button></div><div class="banner-matrix-art" aria-hidden="true"><span class="banner-art-spark">✳</span><div class="art-node art-root"><BrandLogo light symbol /></div><div class="art-node art-left"><AppIcon name="Users" :size="25" /></div><div class="art-node art-right"><AppIcon name="Users" :size="25" /></div><span class="art-connector connector-left"></span><span class="art-connector connector-right"></span></div><div class="banner-plan-card"><span>{{ t('ui.the_distribution') }}</span><div><strong>80<small>%</small></strong><span>{{ t('ui.binary_matrix') }}<br /><b>10% · 20% · 50%</b></span></div><div class="plan-split"><span><b>15%</b> {{ t('ui.unilevel') }}</span><span><b>5%</b> {{ t('ui.system') }}</span></div><p>{{ t('ui.15_ranks_starting_at_10_usdt') }}</p></div></section>

        <div v-if="currentView === 'overview' && !preview" class="dashboard-activity-bar"><span>{{ t('dashboard.accountActivity') }}</span><button class="text-action" :disabled="refreshing" @click="refreshActivity"><AppIcon name="RefreshCw" :size="14" />{{ refreshing ? t('ui.please_wait') : t('admin.refresh') }}</button></div>
        <p v-if="currentView === 'overview' && dashboardError && !preview" class="auth-error" role="alert">{{ tr(dashboardError) }}</p>
        <div v-if="currentView === 'overview' && !preview" class="network-stat-grid" data-testid="account-overview">
          <article class="network-stat"><span class="stat-icon peach-icon"><AppIcon name="CircleDollarSign" :size="19" /></span><div><p>{{ t('ui.total_commissions_credited') }}</p><strong data-testid="overview-commissions">{{ summary ? formatUsdt(summary.commissions) : '—' }}<small>USDT</small></strong><span>{{ t('ui.completed_credits_to_your_wallet') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon green-icon"><AppIcon name="Users" :size="19" /></span><div><p>{{ t('dashboard.directReferrals') }}</p><strong data-testid="overview-direct-referrals">{{ summary?.referrals.direct ?? '—' }}</strong><span>{{ t('dashboard.directHint') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon lavender-icon"><AppIcon name="GitFork" :size="19" /></span><div><p>{{ t('dashboard.networkMembers') }}</p><strong data-testid="overview-network-members">{{ summary?.referrals.total ?? '—' }}{{ summary?.referrals.truncated ? '+' : '' }}</strong><span>{{ t('dashboard.networkHint') }}</span></div></article>
        </div>
        <div v-else-if="currentView === 'overview' || currentView === 'matrix'" class="network-stat-grid">
          <article class="network-stat"><span class="stat-icon peach-icon"><AppIcon name="GitFork" :size="19" /></span><div><p>{{ preview ? t('ui.example_matrix_receipts') : t('ui.matrix_commissions') }}</p><strong>{{ formatUsdt(matrixGross) }}<small>USDT</small></strong><span>{{ preview ? t('ui.illustrative_rank') + " " + selectedRank : t('ui.no_qualifying_positions_yet') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon green-icon"><AppIcon name="Users" :size="19" /></span><div><p>{{ t('ui.unilevel_commissions') }}</p><strong>{{ formatUsdt(preview ? 12.8 : 0) }}<small>USDT</small></strong><span>{{ t('ui.1_per_level_up_to_15_levels') }}</span></div></article>
          <article class="network-stat"><span class="stat-icon lavender-icon"><AppIcon name="Layers" :size="19" /></span><div><p>{{ t('ui.matrix_positions') }}</p><strong>{{ preview ? '11' : '0' }}<small>{{ t('ui.14_filled') }}</small></strong><span>{{ t('ui.2_4_8_positions_across_3_layers') }}</span></div></article>
        </div>

        <div v-if="currentView === 'overview' || currentView === 'matrix'" class="matrix-overview-grid" :class="{ 'matrix-full': currentView === 'matrix' }">
          <section class="panel matrix-panel"><div class="section-card-header"><div><h2>{{ t('ui.your_binary_matrix') }}<span v-if="preview" class="sample-label">{{ t('ui.example') }}</span></h2><p>{{ preview ? t('ui.see_how_a_three_layer_matrix_takes_shape') : t('ui.your_matrix_begins_with_a_qualifying_rank_activation') }}</p></div><div class="rank-selector"><span>{{ t('ui.rank_dd48a') }}</span><AppDropdown v-model="selectedRank" :label="t('ui.select_matrix_rank')" compact :options="ranks.map(rank => ({ value: rank.rank, label: String(rank.rank).padStart(2, '0') + ' · ' + rank.price.toLocaleString(localeTag) + ' USDT' }))" /></div></div><div class="matrix-stage"><MatrixTree :preview="preview" :username="user?.username || tr('You')" /></div><div class="matrix-legend"><span><i class="legend-filled"></i>{{ preview ? t('ui.filled_position') : t('ui.your_position') }}</span><span><i class="legend-open"></i>{{ t('ui.open_position') }}</span><strong>{{ preview ? '11' : '0' }} {{ t('ui.of_14_filled') }}</strong></div><div class="matrix-layer-summary"><div v-for="(layer, index) in activeRank.layers" :key="layer.depth"><div><span class="layer-dot" :class="`layer-${layer.depth}`"></span><strong>{{ t('ui.layer_43436') }} {{ layer.depth }}</strong><span class="layer-rate">{{ layer.rate * 100 }}%</span></div><p>{{ counts[index] }} / {{ layer.positions }} {{ t('ui.positions_4c0bb') }}</p><strong>{{ formatUsdt((counts[index] || 0) * activeRank.price * layer.rate) }} <small>USDT</small></strong></div></div><div class="matrix-foot"><AppIcon name="Info" :size="15" /><span>{{ preview ? t('ui.sample_placement_and_receipts_actual_commissions_require_verified_qualifying_activity') : t('ui.invites_are_tracked_separately_matrix_placement_and_rank_activation_are_awaiting_sett') }}</span></div></section>
          <WalletPanel v-if="currentView === 'overview'" compact :preview="preview" />
        </div>

        <section v-if="currentView === 'overview'" class="panel distribution-panel"><div class="section-card-header"><div><h2>{{ t('ui.a_little_clarity_on_your_commissions') }}</h2><p>{{ t('ui.one_qualifying_payment_distributed_across_the_plan') }}</p></div><NuxtLink to="/dashboard?view=ranks" class="inline-link">{{ t('ui.explore_all_ranks') }}<AppIcon name="ArrowUpRight" :size="14" /></NuxtLink></div><div class="distribution-bar" :aria-label="t('ui.80_percent_binary_matrix_15_percent_unilevel_5_percent_system')"><span></span><span></span><span></span></div><div class="distribution-labels"><span><i></i><strong>80%</strong> {{ t('ui.binary_matrix') }}</span><span><i></i><strong>15%</strong> {{ t('ui.unilevel_1_15') }}</span><span><i></i><strong>5%</strong> {{ t('ui.system') }}</span></div></section>

        <template v-if="currentView === 'referrals'">
          <ReferralAccess :key="user?.id || 'preview'" :preview="preview" @updated="referralsUpdated" />
          <section class="panel member-panel">
            <div class="section-card-header"><div><h2>{{ t('ui.your_referral_network') }}<span class="sample-label">{{ preview ? t('ui.sample_data') : members.length + " " + t('ui.members') }}</span></h2><p>{{ t('ui.your_invites_and_the_connections_growing_from_them') }}</p></div><button class="button button-outline button-small" @click="exportReferrals"><AppIcon name="Download" :size="15" />{{ t('ui.export_csv') }}</button></div>
            <div class="referral-view-bar"><span>{{ t('ui.see_your_connections_your_way') }}</span><div class="referral-view-toggle" role="group" :aria-label="t('ui.referral_view')"><button :aria-pressed="referralLayout === 'list'" :class="{ selected: referralLayout === 'list' }" @click="setReferralLayout('list')"><AppIcon name="List" :size="16" />{{ t('ui.list_view') }}</button><button :aria-pressed="referralLayout === 'tree'" :class="{ selected: referralLayout === 'tree' }" @click="setReferralLayout('tree')"><AppIcon name="GitFork" :size="16" />{{ t('ui.tree_view') }}</button></div></div>
            <div class="member-tools"><label class="search-field"><AppIcon name="Search" :size="17" /><input v-model="search" :aria-label="t('ui.search_referrals')" :placeholder="t('ui.search_by_username')" /></label><AppDropdown v-model="referralStatus" :label="t('ui.filter_referral_status')" :options="[{ value: 'all', label: t('ui.all_statuses') }, { value: 'Registered', label: t('ui.registered') }, ...(preview ? [{ value: 'Qualified', label: t('ui.qualified') }] : [])]" /></div>
            <p v-if="referralError" class="form-error" role="alert">{{ tr(referralError) }}</p>
            <ReferralTree v-if="referralLayout === 'tree'" :members="referralMembers" :root-id="user?.id || 'preview-root'" :username="user?.username || 'You'" :matching-ids="visibleMembers.map((member) => member.id)" :filtered="!!search || referralStatus !== 'all'" />
            <div v-else class="table-scroll"><table><thead><tr><th>{{ t('ui.member') }}</th><th>{{ t('ui.date_joined') }}</th><th>{{ t('ui.status') }}</th><th>{{ t('ui.referral_level') }}</th></tr></thead><tbody><tr v-for="(member, index) in visibleMembers" :key="member.id"><td><div class="member-identity"><span class="table-avatar" :class="`avatar-${['peach', 'lavender', 'green', 'blue'][index % 4]}`">{{ member.username.slice(0, 2).toUpperCase() }}</span><strong>@{{ member.username }}</strong></div></td><td>{{ formatDate(member.joinedAt) }}</td><td><span class="member-status" :class="{ qualified: member.status === 'Qualified' }"><i></i>{{ tr(member.status) }}</span></td><td>{{ t('ui.level') }} {{ member.depth }}{{ member.depth === 1 ? " " + t('ui.direct') : '' }}</td></tr><tr v-if="!visibleMembers.length"><td colspan="4" class="empty-state"><AppIcon name="Users" :size="27" /><strong>{{ search || referralStatus !== 'all' ? t('ui.no_matching_referrals') : t('ui.your_circle_starts_here') }}</strong><span>{{ search || referralStatus !== 'all' ? t('ui.try_another_search_or_status') : t('ui.share_your_invite_link_to_bring_someone_into_your_loop') }}</span></td></tr></tbody></table></div>
            <div class="member-table-foot">{{ visibleMembers.length }} {{ preview ? tr('sample') : tr('network') }} {{ t('ui.members_f13eb') }}{{ networkTruncated ? " " + t('ui.showing_the_first_500_members_8ad45') : '' }} {{ t('ui.up_to_15_referral_levels_179fe') }}</div>
          </section>
        </template>

        <template v-if="currentView === 'ranks'">
          <section class="rank-intro"><span class="outline-pill">{{ t('ui.15_ranks_usdt') }}</span><p>{{ t('ui.select_a_rank_to_explore_its_three_layer_matrix_and_15_level_referral_projection') }}</p></section>
          <div class="rank-grid"><button v-for="rank in ranks" :key="rank.rank" class="rank-card" :class="{ selected: selectedRank === rank.rank }" :aria-pressed="selectedRank === rank.rank" @click="selectedRank = rank.rank"><span class="rank-number">{{ t('ui.rank') }} {{ String(rank.rank).padStart(2, '0') }}<AppIcon v-if="selectedRank === rank.rank" name="CheckCircle2" :size="17" /><AppIcon v-else name="Layers" :size="16" /></span><strong>{{ rank.price.toLocaleString(localeTag) }}<small>USDT</small></strong><span>{{ t('ui.full_matrix_gross') }} <b>{{ rank.gross.toLocaleString(localeTag) }}</b></span></button></div>
          <div class="rank-detail-grid"><section class="panel"><div class="section-card-header"><div><h2>{{ t('ui.rank_dd48a') }} {{ selectedRank }} {{ t('ui.binary_matrix_fe990') }}</h2><p>{{ activeRank.price.toLocaleString(localeTag) }} {{ t('ui.usdt_per_qualifying_position') }}</p></div><span class="sample-label">{{ t('ui.projection') }}</span></div><div class="table-scroll"><table><thead><tr><th>{{ t('ui.layer') }}</th><th>{{ t('ui.positions') }}</th><th>{{ t('ui.rate') }}</th><th>{{ t('ui.gross_usdt') }}</th></tr></thead><tbody><tr v-for="layer in activeRank.layers" :key="layer.depth"><td>{{ t('ui.layer_43436') }} {{ layer.depth }}</td><td>{{ layer.positions }}</td><td>{{ layer.rate * 100 }}%</td><td class="number-cell">{{ formatUsdt(layer.gross) }}</td></tr></tbody><tfoot><tr><td colspan="3">{{ t('ui.full_matrix_gross') }}</td><td>{{ formatUsdt(activeRank.gross) }}</td></tr></tfoot></table></div><div class="cycle-breakdown"><div><span>{{ t('ui.shown_first_cycle_retained_amount') }}</span><strong>{{ formatUsdt(activeRank.firstCycle) }} USDT</strong></div><div><span>{{ t('ui.remaining_cycle_allocation') }}</span><strong>{{ formatUsdt(activeRank.allocated) }} USDT</strong></div><p>{{ t('ui.the_poster_earmarks_part_of_the_first_cycle_for_recycling_or_upgrades_allocation_rule') }}</p></div></section><section class="panel unilevel-explainer"><span class="modal-feature-icon"><AppIcon name="Users" :size="26" /></span><h2>{{ t('ui.15_levels_1_at_each') }}</h2><p>{{ t('ui.a_qualifying_payment_can_distribute_1_to_each_eligible_ancestor_across_15_referral_le') }}</p><div class="unilevel-example"><span>{{ t('ui.one_rank') }} {{ selectedRank }} {{ t('ui.qualifying_payment') }}</span><strong>{{ formatUsdt(activeRank.price * 0.01) }} <small>{{ t('ui.usdt_level') }}</small></strong></div><p>{{ t('ui.matrix_and_referral_trees_may_differ_these_tables_assume_doubling_at_each_depth_to_re') }}</p></section></div>
          <section class="panel unilevel-table"><div class="section-card-header"><div><h2>{{ t('ui.rank_dd48a') }} {{ selectedRank }} {{ t('ui.15_level_unilevel_projection') }}</h2><p>{{ t('ui.fully_filled_example') }} {{ activeRank.price.toLocaleString(localeTag) }} {{ t('ui.usdt_per_position_1_commission') }}</p></div><span class="sample-label">{{ t('ui.conditional_figures') }}</span></div><div class="table-scroll"><table><thead><tr><th>{{ t('ui.referral_depth') }}</th><th>{{ t('ui.positions_at_depth') }}</th><th>{{ t('ui.commission_rate') }}</th><th>{{ t('ui.gross_receipts_usdt') }}</th></tr></thead><tbody><tr v-for="row in projections" :key="row.depth"><td>{{ t('ui.level') }} {{ row.depth }}</td><td>{{ row.positions.toLocaleString(localeTag) }}</td><td>1%</td><td class="number-cell">{{ formatUsdt(row.gross) }}</td></tr></tbody></table></div><p class="wallet-history-note">{{ t('ui.projections_require_qualifying_payments_in_every_shown_position_they_do_not_represent') }}</p></section>
        </template>

        <PlatformExplorer v-if="currentView === 'explorer'" :key="user?.id || 'preview'" :preview="preview" :preview-members="sampleMembers" />

        <WalletPanel v-if="currentView === 'wallet'" :preview="preview" />

        <section v-if="currentView === 'settings'" class="panel account-settings"><div class="section-card-header"><div><h2>{{ t('ui.account_details') }}</h2><p>{{ t('ui.your_identity_and_wallet_connected') }}</p></div><AppIcon name="ShieldCheck" :size="24" /></div><div class="account-settings-row"><div><strong>{{ tr('Language') }}</strong><p>{{ tr('Preferred language') }}</p></div><LocaleSwitcher /></div><div class="account-settings-row"><div><strong>{{ t('ui.appearance') }}</strong><p>{{ t('ui.a_gold_workspace_in_your_preferred_light') }}</p></div><ClientOnly><AppDropdown v-model="colorMode.preference" class="theme-preference-dropdown" :label="t('ui.theme_preference')" :options="[{ value: 'light', label: t('ui.light_theme') }, { value: 'dark', label: t('ui.dark_theme') }]" /><template #fallback><span class="settings-tag">{{ t('ui.appearance') }}</span></template></ClientOnly></div><div class="account-settings-row"><div><strong>{{ t('ui.username') }}</strong><p>{{ user ? '@' + user.username : t('ui.sign_in_to_manage_your_account') }}</p></div><span class="settings-tag">{{ t('ui.username_password') }}</span></div><div class="account-settings-row"><div><strong>{{ t('ui.in_app_wallet') }}</strong><p>{{ wallet?.id || t('ui.automatically_created_with_your_account') }}</p></div><NuxtLink class="button button-outline button-small" to="/dashboard?view=wallet">{{ t('ui.open_wallet') }}<AppIcon name="ArrowUpRight" :size="15" /></NuxtLink></div><div class="account-settings-row"><div><strong>{{ t('ui.personal_invite_code') }}</strong><p>{{ user?.referralCode || t('referral.lockedSetting') }}</p></div><button class="text-action" @click="invite"><AppIcon name="Copy" :size="15" />{{ user?.referralCode ? t('ui.copy_invite') : t('referral.manageAccess') }}</button></div><div class="account-settings-row"><div><strong>{{ t('ui.invited_by') }}</strong><p>{{ user?.sponsorCode || t('ui.no_sponsor_code_applied') }}</p></div><AppIcon name="Users" :size="20" /></div><div class="account-settings-row"><div><strong>{{ t('ui.session_security') }}</strong><p>{{ user ? t('ui.your_session_stays_signed_in_for_up_to_7_days') : t('ui.sign_in_with_your_username_and_password') }}</p></div><button class="button button-outline button-small" @click="user ? signOut() : (authOpen = true)"><AppIcon :name="user ? 'LogOut' : 'LockKeyhole'" :size="16" />{{ user ? t('ui.sign_out') : t('ui.sign_in') }}</button></div></section>

        <footer class="dashboard-footer"><a v-if="platform?.supportEmail" :href="'mailto:' + platform.supportEmail">{{ t('admin.supportEmail') }}</a><span><BrandLogo />{{ t('ui.good_connections_come_full_circle') }}</span><span>{{ preview ? t('ui.illustrative_plan_preview_sample_figures') : t('ui.loop_account_in_app_usdt_ledger') }}<span class="green-dot"></span></span></footer>
      </main>
    </div>
  </div>
</template>
