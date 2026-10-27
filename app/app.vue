<template>
  <NuxtRouteAnnouncer />
  <NuxtLayout><NuxtPage /></NuxtLayout>
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
  title: "UNXO",
  meta: [
    { name: "theme-color", content: computed(() => colorMode.value === "dark" ? "#0d1017" : "#f5f6f8") },
    { name: "description", content: computed(() => t('ui.your_three_layer_binary_matrix_15_referral_levels_and_in_app_usdt_wallet_sign_in_a4950')) },
  ],
});
</script>
