<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { admin } from './store'
import { pipeline, runPipeline, running, stopPipelinePoll } from './eventPipeline'
import EventCatalogPanel from './EventCatalogPanel.vue'
import EventPipelinePanel from './EventPipelinePanel.vue'
import EventReviewPanel from './EventReviewPanel.vue'
import CommunityPanel from './CommunityPanel.vue'
import Ico from '../components/Ico.vue'

// 活动管理：目录整理（编辑、置顶、隐藏）、待审核、讨论管理和数据来源（官网 / 邮件抓取）
type Tab = 'catalog' | 'review' | 'community' | 'sources'
const TABS: Tab[] = ['catalog', 'review', 'community', 'sources']
const saved = (() => { try { return sessionStorage.getItem('admin.events.tab') } catch { return null } })()
const tab = ref<Tab>(TABS.includes(saved as Tab) ? saved as Tab : 'catalog')
watch(tab, (value) => { try { sessionStorage.setItem('admin.events.tab', value) } catch { /* 无存储 */ } })
const tabs = computed(() => [
  { id: 'catalog' as const, label: '活动目录', icon: 'calendar' as const },
  { id: 'review' as const, label: '待审核', icon: 'check' as const, badge: pipeline.status?.review.pending || 0 },
  { id: 'community' as const, label: '讨论管理', icon: 'chat' as const },
  { id: 'sources' as const, label: '数据来源', icon: 'refresh' as const },
])
const catalog = ref<InstanceType<typeof EventCatalogPanel>>()
const topic = ref<{ id: string; name: string } | null>(null)
function showDiscussions(id: string, name: string) { topic.value = { id, name }; tab.value = 'community' }
async function create() { tab.value = 'catalog'; await nextTick(); catalog.value?.startCreate() }
// 抓取跑完后目录会变，切回目录时重新读取
watch(() => running(), (now, before) => { if (before && !now) void catalog.value?.reload() })
onBeforeUnmount(stopPipelinePoll)
</script>

<template>
  <div class="event-workspace">
    <div v-if="!admin.loggedIn" class="data-card event-locked">
      <span class="lock-icon"><Ico name="lock" /></span>
      <h2>登录后管理活动</h2>
      <p>活动目录整理、待审核队列、讨论管理和数据来源都需要管理口令。</p>
      <button class="button primary" @click="admin.loginOpen = true">管理员登录</button>
    </div>
    <template v-else>
      <div class="event-tabs">
        <div role="tablist" aria-label="活动管理">
          <button v-for="t in tabs" :key="t.id" role="tab" :aria-selected="tab === t.id" :class="{ active: tab === t.id }" @click="tab = t.id">
            <Ico :name="t.icon" />{{ t.label }}<span v-if="'badge' in t && t.badge" class="nav-badge">{{ t.badge }}</span>
          </button>
        </div>
        <div class="event-tab-actions">
          <button class="button secondary" :disabled="running() || !!pipeline.starting" title="立即从官网和邮件抓取最新活动" @click="runPipeline()"><Ico name="refresh" />{{ running() ? '抓取中…' : '立即抓取' }}</button>
          <button class="button primary" @click="create"><Ico name="plus" />新建活动</button>
        </div>
      </div>

      <EventCatalogPanel v-show="tab === 'catalog'" ref="catalog" @discussions="showDiscussions" />
      <EventReviewPanel v-if="tab === 'review'" />
      <CommunityPanel v-else-if="tab === 'community'" :topic="topic" @clear-topic="topic = null" />
      <EventPipelinePanel v-else-if="tab === 'sources'" @review="tab = 'review'" />
    </template>
  </div>
</template>

<style scoped>
.event-workspace { display: grid; gap: 16px; }
.event-locked { display: grid; justify-items: center; gap: 10px; padding: 60px 20px; text-align: center; }
.event-locked p { color: var(--muted); font-size: 13px; }
.lock-icon { display: grid; place-items: center; width: 46px; height: 46px; border-radius: 12px; background: #edf4ef; color: #28634e; font-size: 22px; }
.event-tabs { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; border-bottom: 1px solid var(--line); }
.event-tabs [role=tablist] { display: flex; gap: 4px; overflow-x: auto; }
.event-tabs [role=tab] { display: flex; align-items: center; gap: 7px; padding: 10px 14px; margin-bottom: -1px; background: transparent; border-bottom: 2px solid transparent; color: #6b7a71; font-size: 14px; white-space: nowrap; }
.event-tabs [role=tab].active { color: #1f4d3a; border-bottom-color: #28634e; font-weight: 600; }
.event-tabs [role=tab]:hover:not(.active) { color: #33503f; }
.event-tab-actions { display: flex; gap: 8px; padding-bottom: 8px; }
.event-tab-actions .button { min-height: 34px; padding: 6px 12px; font-size: 12px; }
@media (max-width: 760px) { .event-tabs { flex-direction: column; align-items: stretch; } .event-tab-actions { order: -1; justify-content: flex-end; } }
</style>
