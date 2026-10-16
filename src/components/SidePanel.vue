<script setup lang="ts">
import { state } from '../lib/store'
import AdminPanel from './AdminPanel.vue'
import CategoryList from './CategoryList.vue'
import GroupCard from './GroupCard.vue'
import HomePanel from './HomePanel.vue'
import PlaceCard from './PlaceCard.vue'
import RouteCard from './RouteCard.vue'

// 侧栏（桌面）和底部面板（手机）里放同一份内容
</script>

<template>
  <AdminPanel v-if="state.admin" />
  <template v-else>
    <RouteCard v-if="state.route.open" />
    <GroupCard v-if="state.selected?.kind === 'group'" />
    <PlaceCard v-else-if="state.selected" />
    <template v-else-if="!state.route.open">
      <CategoryList v-if="state.chip" />
      <HomePanel v-else />
    </template>
  </template>
</template>
