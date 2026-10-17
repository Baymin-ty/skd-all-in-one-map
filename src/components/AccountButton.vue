<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { account, logoutAccount, openAccount } from '../lib/account'
import { openShare } from '../lib/deepLink'
import { showPanel } from '../lib/store'
import Ico from './Ico.vue'

// 账号入口：没登录直接打开登录框；登录后点头像展开账号菜单（退出登录不会被误点触发）。
const props = defineProps<{ placement?: 'up' | 'down' }>()
const root = ref<HTMLDivElement>()
const open = ref(false)
const ROLE = { student: '同学', organizer: '活动主办方', admin: '管理员' }
const initial = computed(() => account.me?.name.trim().slice(0, 1).toUpperCase() || '我')

function click() {
  if (!account.me) { openAccount(); return }
  open.value = !open.value
}
function shareSite() {
  open.value = false
  openShare({ title: '上科大一图通', links: [{ label: '首页', url: `${window.location.origin}/`, hint: '用手机扫码打开校园地图' }] })
}
function myDay() { open.value = false; showPanel('today') }
async function logout() { open.value = false; await logoutAccount() }
function outside(event: PointerEvent) {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => document.removeEventListener('pointerdown', outside))
</script>

<template>
  <div ref="root" class="account-btn" @keydown.esc="open = false">
    <button v-if="account.me" type="button" class="avatar" :aria-expanded="open" aria-haspopup="menu" :aria-label="`账号：${account.me.name}`" :title="account.me.name" @click="click">{{ initial }}</button>
    <button v-else type="button" class="login" aria-label="登录" title="校内邮箱登录，同步课表和我的地点" @click="click"><Ico name="users" /><span>登录</span></button>
    <div v-if="open && account.me" class="menu" :class="props.placement ?? 'down'" role="menu">
      <div class="who">
        <span class="avatar big">{{ initial }}</span>
        <div class="grow"><b class="ellipsis">{{ account.me.name }}<span class="pill">{{ ROLE[account.me.role] }}</span></b><small class="ellipsis">{{ account.me.email }}</small></div>
      </div>
      <button type="button" role="menuitem" @click="myDay"><Ico name="clock" />我的今天</button>
      <button type="button" role="menuitem" @click="shareSite"><Ico name="grid" />手机扫码使用</button>
      <a v-if="account.me.role !== 'student'" role="menuitem" href="/admin/" target="_blank" rel="noopener" @click="open = false"><Ico name="lock" />管理后台<Ico name="external" class="tail" /></a>
      <hr />
      <button type="button" role="menuitem" class="danger" :disabled="account.busy" @click="logout"><Ico name="back" />退出登录</button>
    </div>
  </div>
</template>

<style scoped>
.account-btn { position: relative; flex: none; }
.avatar { display: grid; place-items: center; width: 36px; height: 36px; padding: 0; border: 2px solid #fff; border-radius: 50%; background: linear-gradient(135deg, #c13a40, var(--brand)); color: #fff; font-size: 15px; font-weight: 700; box-shadow: 0 0 0 1px var(--line); cursor: pointer; }
.avatar.big { flex: none; width: 40px; height: 40px; border: 0; box-shadow: none; cursor: default; }
.login { display: inline-flex; align-items: center; gap: 4px; height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 999px; background: #fff; color: var(--ink); font-size: 13px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.login .svgi { font-size: 15px; color: var(--brand); }
@media (hover: hover) { .login:hover { background: var(--bg-2); } }
.menu { position: absolute; z-index: 1200; width: 260px; padding: 6px; border-radius: 16px; background: #fff; box-shadow: 0 10px 36px #0000002e, 0 0 0 1px #0000000a; }
.menu.down { top: calc(100% + 8px); right: 0; }
.menu.up { bottom: 0; left: calc(100% + 10px); }
.who { display: flex; align-items: center; gap: 10px; padding: 10px 8px 12px; }
.who b, .who small { display: block; }
.who b { font-size: 15px; }
.who .pill { margin-left: 6px; vertical-align: 2px; font-size: 10.5px; }
.who small { color: var(--ink-3); font-size: 12px; }
.menu > button, .menu > a { display: flex; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 10px; background: none; color: var(--ink); font-size: 14px; text-align: left; cursor: pointer; }
.menu > button .svgi, .menu > a .svgi { font-size: 17px; color: var(--ink-2); }
.menu .tail { margin-left: auto; font-size: 13px !important; color: var(--ink-3) !important; }
.menu .danger, .menu .danger .svgi { color: #b3261e; }
.menu hr { margin: 4px 6px; border: 0; border-top: 1px solid var(--line); }
@media (hover: hover) { .menu > button:hover, .menu > a:hover { background: var(--bg-2); } }
</style>
