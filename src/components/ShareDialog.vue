<script setup lang="ts">
import qrcode from 'qrcode-generator'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { share } from '../lib/deepLink'
import { toast } from '../lib/store'
import Ico from './Ico.vue'
import { isEnglish } from '../lib/i18n'

const target = computed(() => share.target!)
const picked = ref(0)
const link = computed(() => target.value.links[picked.value] ?? target.value.links[0])
const qr = computed(() => {
  const code = qrcode(0, 'M')
  code.addData(link.value.url)
  code.make()
  return code
})
// 库生成的 SVG 只包含方块路径，内容来自本站链接
const svg = computed(() => qr.value.createSvgTag({ cellSize: 4, margin: 2, scalable: true }))
const local = /^(localhost|127\.|\[::1\])/.test(window.location.hostname)
const close = () => { share.target = null }
const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

async function copy() {
  try {
    await navigator.clipboard.writeText(link.value.url)
    toast('链接已复制')
  } catch {
    toast('复制失败，请长按链接手动复制')
  }
}
async function systemShare() {
  try {
    await navigator.share({ title: target.value.title, url: link.value.url })
  } catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) copy()
  }
}
/** 下载带标题的二维码图片，方便印在海报上 */
function download() {
  const n = qr.value.getModuleCount()
  const cell = 10
  const pad = 40
  const canvas = document.createElement('canvas')
  canvas.width = n * cell + pad * 2
  canvas.height = n * cell + pad * 2 + 56
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = '#1d1d1f'
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.value.isDark(r, c)) ctx.fillRect(pad + c * cell, pad + r * cell, cell, cell)
  ctx.font = '600 22px -apple-system, "PingFang SC", sans-serif'
  ctx.textAlign = 'center'
  const title = target.value.title.length > 22 ? target.value.title.slice(0, 21) + '…' : target.value.title
  ctx.fillText(title, canvas.width / 2, n * cell + pad + 40)
  ctx.font = '16px -apple-system, "PingFang SC", sans-serif'
  ctx.fillStyle = '#8a8a92'
  ctx.fillText(`上科大一图通 · ${link.value.hint}`, canvas.width / 2, n * cell + pad + 68)
  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `${target.value.title.slice(0, 30)}-二维码.png`
  a.click()
}
const canShare = typeof navigator.share === 'function'
</script>

<template>
  <div class="share-backdrop" @click.self="close">
    <div class="share-dialog" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div class="head">
        <h2 id="share-title" class="title">{{ target.title }}</h2>
        <button type="button" class="close" :aria-label="isEnglish ? 'Close' : '关闭'" @click="close"><Ico name="close" /></button>
      </div>
      <div v-if="target.links.length > 1" class="filter-chips" aria-label="扫码后打开">
        <button v-for="(l, i) in target.links" :key="l.label" type="button" :class="{ on: picked === i }" :aria-pressed="picked === i" @click="picked = i">{{ l.label }}</button>
      </div>
      <div class="qr" role="img" :aria-label="`${isEnglish ? 'QR code' : '二维码'}: ${link.hint}`" v-html="svg" />
      <p class="hint">{{ link.hint }}</p>
      <p v-if="local" class="note warn">现在是本机地址，手机扫不开。部署到线上或用局域网地址打开本页后再分享。</p>
      <input class="url" :value="link.url" readonly aria-label="分享链接" @focus="($event.target as HTMLInputElement).select()" />
      <div class="actions">
        <button type="button" class="act primary" @click="copy"><Ico name="external" />{{ isEnglish ? 'Copy link' : '复制链接' }}</button>
        <button type="button" class="act" @click="download"><Ico name="download" />{{ isEnglish ? 'Download QR' : '下载二维码' }}</button>
        <button v-if="canShare" type="button" class="act" @click="systemShare">{{ isEnglish ? 'More sharing' : '更多分享' }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.share-backdrop { position: fixed; inset: 0; z-index: 3000; display: grid; place-items: center; padding: 16px; background: #1d1d1f66; }
.share-dialog { width: min(360px, 100%); max-height: calc(100vh - 32px); overflow: auto; padding: 16px 18px 18px; border-radius: 18px; background: #fff; box-shadow: 0 20px 60px #0000004d; }
.share-dialog .title { font-size: 17px; overflow-wrap: anywhere; }
.qr { width: 220px; margin: 12px auto 4px; }
.qr :deep(svg) { display: block; width: 100%; height: auto; }
.hint { text-align: center; font-size: 12.5px; color: var(--ink-2); }
.note.warn { background: #fff4e5; color: #8a4b08; font-size: 12px; }
.url { width: 100%; margin-top: 12px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg-2); font-size: 12px; color: var(--ink-2); }
.share-dialog .actions { flex-wrap: wrap; }
</style>
