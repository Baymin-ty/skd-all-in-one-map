<script setup lang="ts">
import { ICONS, type IconName } from '../lib/icons'

defineProps<{ name: IconName }>()
</script>

<template>
  <span class="svgi" v-html="ICONS[name]" />
</template>
