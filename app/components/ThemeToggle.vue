<script setup lang="ts">
const { tr } = useLoopI18n();

const colorMode = useColorMode();
const isDark = computed(() => colorMode.value === "dark");
const label = computed(() => tr(isDark.value ? "Use light theme" : "Use dark theme"));

function toggleTheme() {
  colorMode.preference = isDark.value ? "light" : "dark";
}
</script>

<template>
  <ClientOnly>
    <button class="theme-toggle" type="button" :aria-label="label" :title="label" @click="toggleTheme">
      <AppIcon :name="isDark ? 'Sun' : 'Moon'" :size="18" />
    </button>
    <template #fallback><span class="theme-toggle" aria-hidden="true"></span></template>
  </ClientOnly>
</template>
