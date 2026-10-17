<script setup lang="ts">
const { t, tr, localeTag, formatDate } = useLoopI18n();
</script>
<template>
  <div
    class="referral-visual"
    :aria-label="t('ui.illustrative_matrix_connections_and_usdt_commission_preview')"
    role="img"
  >
    <div class="visual-grid"></div>
    <div class="orbital orbital-one"></div>
    <div class="orbital orbital-two"></div>
    <svg class="visual-connectors" viewBox="0 0 560 490" fill="none">
      <path
        d="M127 131H228V224M429 155H346V235M121 349H231V275M422 356H344V280"
        stroke="#D7B9A9"
        stroke-width="1.5"
        stroke-dasharray="5 6"
      />
      <circle cx="127" cy="131" r="4" fill="#EF734B" />
      <circle cx="429" cy="155" r="4" fill="#EF734B" />
      <circle cx="121" cy="349" r="4" fill="#EF734B" />
      <circle cx="422" cy="356" r="4" fill="#EF734B" />
    </svg>
    <div class="center-token">
      <BrandLogo symbol />
    </div>
    <div class="friend-card friend-one">
      <span class="visual-avatar avatar-peach">J<span>✦</span></span>
      <div>
        <strong>{{ t('ui.a_new_connection') }}</strong
        ><span>{{ t('ui.your_network_coming_together') }}</span>
      </div>
      <span class="tiny-check"><AppIcon name="Check" :size="12" /></span>
    </div>
    <div class="floating-coin coin-one"><UsdtIcon /></div>
    <div class="floating-coin coin-two"><UsdtIcon /></div>
    <div class="visual-spark spark-one">✳</div>
    <div class="visual-spark spark-two">✧</div>
    <div class="visual-spark spark-three">✦</div>
    <div class="reward-notification">
      <span class="reward-notification-icon"
        ><AppIcon name="Gift" :size="24"
      /></span>
      <div>
        <span>{{ t('ui.layer_2_rank_1_example') }}</span
        ><strong>+ 8.00 <small>USDT</small></strong>
      </div>
      <span class="reward-pill"
        >{{ t('ui.preview') }} <AppIcon name="Check" :size="11"
      /></span>
    </div>
    <div class="mini-profile mini-one">
      <span class="avatar-lavender">A</span>
    </div>
    <div class="mini-profile mini-two"><span class="avatar-green">M</span></div>
    <div class="visual-caption">
      <span class="green-dot"></span> {{ t('ui.connections_that_give_back') }}
    </div>
  </div>
</template>
