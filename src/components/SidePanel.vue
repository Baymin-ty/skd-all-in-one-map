<script setup lang="ts">
import { nextTick, watch } from 'vue'
import { state } from '../lib/store'
import DiningPanel from './DiningPanel.vue'
import CanteenDetail from './CanteenDetail.vue'
import EventsPanel from './EventsPanel.vue'
import CategoryList from './CategoryList.vue'
import GroupCard from './GroupCard.vue'
import HomePanel from './HomePanel.vue'
import PlaceCard from './PlaceCard.vue'
import ProfilePanel from './ProfilePanel.vue'
import RouteCard from './RouteCard.vue'
import TodayPanel from './TodayPanel.vue'

// 前台侧栏与手机底部面板共用浏览内容；功能切换在 NavTabs，管理页面有独立入口。
watch(() => [state.panel, state.eventId, state.menu.dish, state.canteen.dish, state.canteen.id, state.route.open, state.selected?.id], async () => {
  await nextTick()
  document.querySelector('.side-scroll, .sheet-body')?.scrollTo({ top: 0 })
})
</script>

<template>
  <RouteCard v-if="state.route.open" />
  <EventsPanel v-if="state.panel === 'events'" />
  <DiningPanel v-else-if="state.panel === 'dining'" />
  <CanteenDetail v-else-if="state.panel === 'canteen'" />
  <TodayPanel v-else-if="state.panel === 'today' && !state.selected" />
  <ProfilePanel v-else-if="state.panel === 'me' && !state.selected" />
  <GroupCard v-else-if="state.selected?.kind === 'group'" />
  <PlaceCard v-else-if="state.selected" />
  <template v-else-if="!state.route.open">
    <CategoryList v-if="state.chip" />
    <HomePanel v-else />
  </template>
</template>
