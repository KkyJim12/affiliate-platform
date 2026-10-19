<script setup lang="ts">
const { user, updateUsername } = useAccount();
const { t } = useLoopI18n();
const { errorMessage } = useAdminTools();
const { notify } = useAppUI();
const inputId = `account-username-${useId()}`;
const username = ref(user.value?.username || "");
const busy = ref(false);
const error = ref("");
const dirty = computed(() => username.value.trim().toLowerCase() !== user.value?.username);
watch(() => user.value?.username, value => { username.value = value || ""; error.value = ""; });
async function save() {
  if (busy.value || !dirty.value) return;
  busy.value = true;
  error.value = "";
  try {
    await updateUsername(username.value);
    notify(t("profile.usernameSaved"));
  } catch (failure) { error.value = errorMessage(failure); }
  finally { busy.value = false; }
}
</script>

<template>
  <form v-if="user" class="account-form username-form" @submit.prevent="save">
    <label :for="inputId">{{ t('ui.username') }}</label>
    <p :id="`${inputId}-hint`">{{ t('profile.usernameHint') }}</p>
    <div class="username-form-controls">
      <input :id="inputId" v-model="username" class="auth-input" type="text" autocomplete="username" autocapitalize="none"
        spellcheck="false" required minlength="3" maxlength="24" pattern="[a-zA-Z][a-zA-Z0-9_]{2,23}" :disabled="busy"
        :aria-describedby="`${inputId}-hint`" :aria-invalid="error ? true : undefined" />
      <button type="submit" class="button button-outline button-small" :disabled="busy || !dirty">
        {{ busy ? t('ui.please_wait') : t('profile.saveUsername') }}
      </button>
    </div>
    <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
  </form>
</template>

<style scoped>
.username-form { display: grid; gap: 8px; width: 100%; min-width: 0; }
.username-form label { color: var(--text-primary); font-size: 13px; font-weight: 650; }
.username-form p { margin: 0; color: var(--text-secondary); font-size: 12px; line-height: 1.6; }
.username-form-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
.username-form-controls .auth-input { flex: 1 1 160px; width: 100%; min-width: 0; margin-bottom: 0; }
.username-form-controls .button { flex: 0 0 auto; }
.username-form p.auth-error { color: var(--danger); }
</style>
