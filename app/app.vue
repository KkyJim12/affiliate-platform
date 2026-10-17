<template>
  <NuxtRouteAnnouncer />
  <NuxtPage />
  <AuthModal />
  <Transition name="toast">
    <div v-if="toast" class="app-toast" role="status">
      <AppIcon name="CheckCircle2" :size="19" />{{ tr(toast) }}
    </div>
  </Transition>
</template>

<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();

const { toast } = useAppUI();
const colorMode = useColorMode();
useHead({
  htmlAttrs: { lang: computed(() => localeTag.value), dir: "ltr" },
  title: computed(() => `Loop — ${tr('Your network, connected.')}`),
  meta: [
    { name: "theme-color", content: computed(() => colorMode.value === "dark" ? "#0d1017" : "#f5f6f8") },
    { name: "description", content: computed(() => tr('Your three-layer binary matrix, 15 referral levels, and in-app USDT wallet. Sign in with your username and password.')) },
  ],
});
</script>
