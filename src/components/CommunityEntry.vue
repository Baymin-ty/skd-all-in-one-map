<script setup lang="ts">
import { openCommunity, type CommunityTarget } from '../lib/community'
import { account } from '../lib/account'
import Ico from './Ico.vue'
defineProps<{ target: CommunityTarget; compact?: boolean }>()
const ENTRY = { event: '这场活动，聊一聊', stall: '这个档口，大家怎么说', place: '这里怎么样，大家怎么说' }
function enter(target: CommunityTarget) { openCommunity(target) }
</script>
<template>
  <button type="button" class="community-entry" :class="{ compact }" @click="enter(target)">
    <span class="entry-icon"><Ico name="chat" /></span>
    <span class="entry-copy"><b>{{ account.me ? (compact ? '交流 · 发笔记' : ENTRY[target.type]) : '登录后参与交流' }}</b><small v-if="!compact">{{ account.me ? '图文分享 · 同学问答 · AI 总结' : '浏览讨论无需登录' }}</small></span>
    <Ico name="chevron" />
  </button>
</template>
<style scoped>
.community-entry { width: 100%; display: flex; align-items: center; gap: 10px; padding: 14px; margin: 18px 0; border: 1px solid #f0dcdc; border-radius: 15px; background: linear-gradient(110deg, #fff5f3, #fffaf7); color: #903035; text-align: left; cursor: pointer; }
.entry-icon { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 12px; background: #fff; font-size: 20px; }
.entry-copy { flex: 1; min-width: 0; }.entry-copy b { display: block; font-size: 14px; }.entry-copy small { display: block; font-size: 11px; color: #9a7271; margin-top: 4px; }
.compact { width: auto; margin: 0; padding: 6px 10px; border-radius: 999px; gap: 5px; background: #fff; }.compact .entry-icon { width: auto; height: auto; font-size: 14px; }.compact .entry-copy b { font-size: 11px; }.compact > .svgi { display: none; }
.community-entry:hover { border-color: #cd9294; }
</style>
