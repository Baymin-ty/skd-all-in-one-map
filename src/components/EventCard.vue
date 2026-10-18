<script setup lang="ts">
import { computed } from 'vue'
import type { CampusEvent } from '../lib/discoveryTypes'
import { EVENT_CATS } from '../lib/discoveryData'
import { dayLabel, eventStatus, evStart, STATUS_LABELS, timeRange } from '../lib/campusTime'
import { openEvent } from '../lib/store'
import { displayText, isEnglish, t } from '../lib/i18n'
import { techathonBadge } from '../lib/eventVisuals'
const props = defineProps<{ event: CampusEvent; showDay?: boolean }>()
const status = computed(() => eventStatus(props.event))
const badge = computed(() => techathonBadge(props.event))
</script>

<template>
  <button type="button" class="event-card tap" :class="{ techathon: badge }" @click="openEvent(event.id)">
    <span v-if="badge" class="event-mark" aria-hidden="true"><span>⚡</span></span>
    <span class="when">
      <small v-if="badge" class="main-badge">{{ isEnglish ? 'Main event' : badge.label }}</small>
      <span v-if="status === 'live' || status === 'soon'" class="pill" :class="status">{{ isEnglish ? (status === 'live' ? 'Live' : 'Starting soon') : STATUS_LABELS[status] }}</span>
      <b v-else>{{ timeRange(event) }}</b>
      <small v-if="showDay">{{ dayLabel(evStart(event)) }}</small>
      <small v-if="status === 'live' || status === 'soon'">{{ timeRange(event) }}</small>
    </span>
    <span class="event-body">
      <b class="event-title">{{ displayText(event.title, event.title_en) }}</b>
      <span class="meta">{{ event.venueRaw || event.unmapped || t('event.location') }}</span>
      <span class="meta secondary"><span v-if="event.status === 'cancelled'" class="cancelled-label">{{ t('event.cancelled') }} · </span>{{ isEnglish ? ({ lecture: 'Lecture', conference: 'Conference', culture: 'Culture', student: 'Student', career: 'Career', library: 'Library', international: 'International', wellbeing: 'Wellbeing', campus: 'Campus', other: 'Other' } as Record<string, string>)[event.category] : EVENT_CATS[event.category] }}<template v-if="event.organizer"> · {{ event.organizer }}</template></span>
    </span>
  </button>
</template>

<style scoped>
.event-card { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 10px; width: 100%; padding: 13px 3px; border: 0; border-bottom: 1px solid var(--line); border-radius: 8px; background: #fff; text-align: left; color: var(--ink); }
.event-card.techathon { grid-template-columns: 42px 76px minmax(0, 1fr); padding: 14px 8px; border: 1px solid #3b1116; border-bottom-width: 2px; background: radial-gradient(circle at 16% 20%, #ff4d5620, transparent 42%), linear-gradient(125deg, #16090b, #2a0b13 65%, #0e0d16); color: #fff; box-shadow: 0 8px 22px #8f1e2e22; }
.event-mark { display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #ff4d56aa; border-radius: 10px; background: #ff26351f; color: #ff4d56; font-size: 20px; box-shadow: 0 0 16px #ff263555; }
.event-mark span { transform: translateY(-1px); }
.main-badge { padding: 2px 6px; border-radius: 5px; background: #ff4d56; color: #22090c !important; font-size: 10px !important; font-weight: 800; letter-spacing: .04em; }
.techathon .when b, .techathon .event-title { color: #fff; }
.techathon .meta { color: #ffd9dc; }
.techathon .secondary { color: #ffadb3; }
.when { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.when b { font-size: 12px; font-variant-numeric: tabular-nums; }
.when small { font-size: 11px; color: var(--ink-3); }
.when .pill { font-size: 11px; padding: 2px 6px; }
.event-title { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; font-size: 14.5px; line-height: 1.45; }
.meta { display: block; margin-top: 4px; font-size: 12px; color: var(--ink-2); }
.secondary { font-size: 11px; color: var(--ink-3); }
.cancelled-label { color: #ad4f43; }
</style>
