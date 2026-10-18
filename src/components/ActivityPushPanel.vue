<script setup lang="ts">
import { dayName, nowTick, timestamp, dateKey } from '../lib/campusTime'
import { fromMin } from '../lib/today'
import type { ActivityPushSuggestion } from '../lib/planner'
import { openEvent, placeName, placeSelection } from '../lib/store'
import Ico from './Ico.vue'

withDefaults(defineProps<{
  suggestions: ActivityPushSuggestion[]
  title?: string
  subtitle?: string
  emptyText?: string
  showEmpty?: boolean
  compact?: boolean
  allowAdd?: boolean
}>(), {
  title: '智能活动推送',
  subtitle: '按你的课表筛掉时间冲突和来不及赶路的活动',
  emptyText: '这段时间没有找到合适的活动。',
  showEmpty: false,
  compact: false,
  allowAdd: true,
})
const emit = defineEmits<{ add: [suggestion: ActivityPushSuggestion] }>()

const dayText = (date: string) => {
  const today = dateKey(nowTick.value)
  if (date === today) return '今天'
  if (date === dateKey(timestamp(today) + 86_400_000)) return '明天'
  return `${date.slice(5).replace('-', '/')} ${dayName(date)}`
}
const locationText = (suggestion: ActivityPushSuggestion) => {
  const selection = suggestion.event.place ? placeSelection(suggestion.event.place) : null
  return selection ? placeName(selection) : suggestion.event.venueRaw || suggestion.event.unmapped || '地点待确认'
}
const fitText = (suggestion: ActivityPushSuggestion) => {
  const before = suggestion.prev ? `接在「${suggestion.prev.title}」之后` : '当天第一项安排前'
  return `${before}，步行 ${suggestion.walkIn} 分钟可到`
}
</script>

<template>
  <section v-if="suggestions.length || showEmpty" class="activity-push" :class="{ compact }">
    <div class="activity-push-head">
      <div>
        <h3>{{ title }}</h3>
        <p>{{ subtitle }}</p>
      </div>
      <span class="activity-push-icon"><Ico name="sparkles" /></span>
    </div>
    <div v-if="suggestions.length" class="activity-push-list">
      <article v-for="suggestion in suggestions" :key="suggestion.event.id" class="activity-push-card">
        <span class="activity-push-date"><b>{{ dayText(suggestion.date) }}</b><small>{{ fromMin(suggestion.start) }}–{{ fromMin(suggestion.end) }}</small></span>
        <div class="activity-push-body">
          <button type="button" class="activity-push-title" @click="openEvent(suggestion.event.id)">{{ suggestion.event.title }}</button>
          <p>{{ locationText(suggestion) }}<template v-if="suggestion.event.room"> · {{ suggestion.event.room }}</template></p>
          <small class="activity-push-fit">{{ fitText(suggestion) }}<template v-if="suggestion.next"> · 结束后步行 {{ suggestion.walkOut }} 分钟赶上「{{ suggestion.next.title }}」</template></small>
          <button v-if="allowAdd" type="button" class="act small" @click="emit('add', suggestion)"><Ico name="plus" />加入我的今天</button>
        </div>
      </article>
    </div>
    <p v-else class="activity-push-empty"><Ico name="calendar" />{{ emptyText }}</p>
  </section>
</template>

<style scoped>
.activity-push { margin-top: 18px; padding: 14px; border: 1px solid #dce7f6; border-radius: 16px; background: linear-gradient(145deg, #f7faff, #fff); }
.activity-push.compact { margin: 14px 0; padding: 12px; border-radius: 13px; }
.activity-push-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.activity-push-head h3 { margin: 0; font-size: 15px; }
.activity-push-head p { margin-top: 3px; color: var(--ink-3); font-size: 11.5px; line-height: 1.45; }
.activity-push-icon { display: grid; place-items: center; flex: none; width: 32px; height: 32px; border-radius: 10px; background: #e8f0ff; color: #4d75bd; font-size: 17px; }
.activity-push-list { margin-top: 10px; }
.activity-push-card { display: flex; gap: 10px; padding: 10px 0; border-top: 1px solid #e5ebf4; }
.activity-push-card:first-child { border-top: 0; }
.activity-push-date { display: flex; flex-direction: column; flex: 0 0 58px; gap: 2px; color: #4d75bd; font-variant-numeric: tabular-nums; }
.activity-push-date b { font-size: 12px; }
.activity-push-date small { font-size: 11px; color: var(--ink-3); }
.activity-push-body { min-width: 0; flex: 1; }
.activity-push-title { display: block; max-width: 100%; padding: 0; border: 0; background: none; color: var(--ink); font-size: 14px; font-weight: 700; line-height: 1.4; text-align: left; cursor: pointer; }
.activity-push-title:hover { color: var(--brand); }
.activity-push-body p { margin-top: 2px; color: var(--ink-2); font-size: 12px; }
.activity-push-fit { display: block; margin-top: 4px; color: #57718d; font-size: 11.5px; line-height: 1.45; }
.activity-push-body .act { margin-top: 7px; }
.activity-push-empty { display: flex; align-items: center; gap: 6px; margin-top: 10px; color: var(--ink-2); font-size: 12px; }
.activity-push-empty .svgi { color: #5c7bb8; }
@media (max-width: 420px) { .activity-push { padding: 12px; } .activity-push-date { flex-basis: 54px; } }
</style>
