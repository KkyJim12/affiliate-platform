<script setup lang="ts">
import type { PlatformSettings } from "../../../shared/admin";
definePageMeta({ layout: "admin", middleware: "admin", alias: ["/admin/setting"] });
const { t } = useLoopI18n();
const { user } = useAccount();
const { errorMessage } = useAdminTools();
const { notify } = useAppUI();
const colorMode = useColorMode();
const root = ref<HTMLElement | null>(null);
usePageMotion(root);
const { data, error, refresh } = await useFetch<PlatformSettings>("/api/admin/settings");
const form = reactive<PlatformSettings>({ registrationOpen: true, fundingOpen: true, supportEmail: "" });
watch(data, value => { if (value) Object.assign(form, value); }, { immediate: true });
const busy = ref(false);
const actionError = ref("");
const dirty = computed(() => !!data.value && JSON.stringify(form) !== JSON.stringify(data.value));
async function save() {
  if (busy.value) return;
  busy.value = true;
  actionError.value = "";
  try { data.value = await $fetch<PlatformSettings>("/api/admin/settings", { method: "PUT", body: { ...form } }); notify(t("admin.settingsSaved")); }
  catch (failure) { actionError.value = errorMessage(failure); }
  finally { busy.value = false; }
}
useHead({ title: computed(() => `${t('admin.settings')} · UNXO`) });
</script>
<template>
  <main ref="root" class="admin-content"><div class="admin-page-heading"><div><span class="admin-eyebrow">{{ t('admin.platformPreferences') }}</span><h1>{{ t('admin.settings') }}</h1><p>{{ t('admin.settingsSubtitle') }}</p></div><span class="admin-count-badge"><AppIcon name="ShieldCheck" :size="16" />{{ t('admin.administrator') }}</span></div><div v-if="error" class="admin-load-error" role="alert">{{ t('admin.loadError') }}<button class="admin-text-button" @click="refresh()">{{ t('admin.retry') }}</button></div><div class="admin-settings-grid"><form v-if="data" class="admin-panel admin-settings-form" @submit.prevent="save"><div class="admin-panel-heading"><div><h2>{{ t('admin.platformControls') }}</h2><p>{{ t('admin.controlsHint') }}</p></div><AppIcon name="SlidersHorizontal" :size="22" /></div><div class="admin-setting-row"><div><label for="registrations-open">{{ t('admin.registrationOpen') }}</label><p>{{ t('admin.registrationHint') }}</p></div><button id="registrations-open" class="admin-switch" :class="{ enabled: form.registrationOpen }" type="button" role="switch" :aria-checked="form.registrationOpen" :disabled="busy" @click="form.registrationOpen = !form.registrationOpen"><span></span></button></div><div class="admin-setting-row"><div><label for="funding-open">{{ t('admin.fundingOpen') }}</label><p>{{ t('admin.fundingHint') }}</p></div><button id="funding-open" class="admin-switch" :class="{ enabled: form.fundingOpen }" type="button" role="switch" :aria-checked="form.fundingOpen" :disabled="busy" @click="form.fundingOpen = !form.fundingOpen"><span></span></button></div><div class="admin-setting-field"><label for="support-email">{{ t('admin.supportEmail') }}</label><p>{{ t('admin.supportHint') }}</p><input id="support-email" v-model="form.supportEmail" type="email" maxlength="254" class="auth-input" placeholder="support@example.com" :disabled="busy" /></div><div class="admin-settings-save"><p v-if="actionError" class="auth-error" role="alert">{{ actionError }}</p><span v-else>{{ dirty ? t('admin.unsavedChanges') : t('admin.upToDate') }}</span><button class="button button-orange" type="submit" :disabled="busy || !dirty">{{ busy ? t('ui.please_wait') : t('admin.saveChanges') }}<AppIcon name="Check" :size="16" /></button></div></form><div class="admin-settings-side"><section class="admin-panel"><div class="admin-panel-heading"><div><h2>{{ t('admin.yourWorkspace') }}</h2><p>{{ t('admin.personalPreferences') }}</p></div></div><div class="admin-setting-row"><strong>{{ t('ui.language') }}</strong><LocaleSwitcher /></div><div class="admin-setting-row"><strong>{{ t('ui.appearance') }}</strong><ClientOnly><AppDropdown v-model="colorMode.preference" class="theme-preference-dropdown" :label="t('ui.theme_preference')" :options="[{ value: 'light', label: t('ui.light_theme') }, { value: 'dark', label: t('ui.dark_theme') }]" /></ClientOnly></div></section><section class="admin-panel admin-security-card"><AppIcon name="ShieldCheck" :size="27" /><h2>{{ t('admin.sessionAccount') }}</h2><strong>@{{ user?.username }}</strong><p>{{ t('admin.securityHint') }}</p></section></div></div></main>
</template>
