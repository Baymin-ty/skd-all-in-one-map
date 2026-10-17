<script setup lang="ts">
import { computed } from 'vue'
import { account, openAccount } from '../lib/account'
import { showPanel, state } from '../lib/store'
import Ico from './Ico.vue'

// 桌面左栏左下角的账号入口：未登录点开登录框，登录后显示昵称首字头像、点进「我的」。
const initial = computed(() => account.me?.nameSet ? [...account.me.name.trim()][0]?.toUpperCase() : '')
const label = computed(() => account.me ? (account.me.nameSet ? account.me.name : '起个昵称') : '登录')
function go() {
  if (!account.me || !account.me.nameSet) openAccount()
  else showPanel('me')
}
</script>

<template>
  <button type="button" class="rail-account" :class="{ on: state.panel === 'me', in: !!account.me }" :title="label" :aria-label="label" @click="go">
    <span class="avatar"><b v-if="initial">{{ initial }}</b><Ico v-else name="user" /></span>
    <span class="name">{{ label }}</span>
  </button>
</template>

<style scoped>
.rail-account { display: flex; flex-direction: column; align-items: center; gap: 4px; width: 100%; padding: 4px 0; border: 0; background: none; color: var(--ink-3); font-size: 11px; font-weight: 600; cursor: pointer; }
.avatar { display: grid; place-items: center; width: 38px; height: 38px; border: 2px solid var(--line); border-radius: 50%; background: var(--bg-2); color: var(--ink-3); font-size: 20px; transition: border-color 0.15s, box-shadow 0.15s; }
.avatar b { font-size: 16px; }
.in .avatar { border-color: #fff; background: linear-gradient(135deg, #c13a40, var(--brand)); color: #fff; box-shadow: 0 1px 4px #0002; }
.on .avatar { box-shadow: 0 0 0 3px var(--brand-soft); }
.on { color: var(--brand); }
.name { max-width: calc(var(--rail-w, 72px) - 8px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (hover: hover) { .rail-account:hover .avatar { border-color: var(--brand); } }
</style>
