<script setup lang="ts">
const { user } = useAccount();
const { t } = useLoopI18n();
</script>

<template>
  <div v-if="user" class="account-identity">
    <strong>{{ t('publicTree.memberId') }}</strong>
    <p data-testid="account-member-id">{{ user.memberId }}</p>
    <p>{{ t('profile.memberIdHint') }}</p>
  </div>
</template>
