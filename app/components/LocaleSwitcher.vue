<script setup lang="ts">
const { locale, setLocale } = useI18n();
const { tr } = useLoopI18n();
const changing = ref(false);
async function change(language: string) {
  if (language !== "en" && language !== "th") return;
  changing.value = true;
  try { await setLocale(language); }
  finally { changing.value = false; }
}
</script>

<template>
  <AppDropdown class="language-switcher" :model-value="locale" :label="tr('Language')" :busy="changing" compact
    :options="[{ value: 'en', label: 'English', shortLabel: 'EN' }, { value: 'th', label: 'ไทย' }]" @update:model-value="change">
    <template #leading><AppIcon name="Globe" :size="15" /></template>
  </AppDropdown>
</template>
