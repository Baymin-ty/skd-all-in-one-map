<script setup lang="ts">
import { computed } from 'vue'
import { openAccount } from '../lib/account'
import { hasMyMap } from '../lib/profile'
import { openDining, setMapView } from '../lib/store'
import { discovery } from '../lib/discoveryData'
import { CROWD_LABELS, crowdRevision, outletCrowd } from '../lib/crowd'
import { nowTick } from '../lib/campusTime'
import { outletSummary, outletTone } from '../lib/canteenMenu'
import { openParcelStationMap } from '../lib/parcelStation'
import { ui } from '../lib/ui'
import Ico from './Ico.vue'
import UpNextCard from './UpNextCard.vue'

// 全校地图的面板：没登录也没课表时最上面邀请登录（登录后默认看我的地图）；从我的地图切过来的，
// 最上面是「回到我的地图」和接下来那张卡片。下面只放食堂现在排不排队，一个食堂一行；
// 活动在「活动」页，楼群和校门直接在地图上点。
/**
 * 每个食堂取排队最短的营业档口（有 30 分钟内的反馈就是实时的，否则按下课时间估算），都没营业就显示营业时间。
 * 有档口在营业的食堂排前面，同样营业的按最短排队排。
 */
const canteens = computed(() => {
  void crowdRevision.value
  const t = nowTick.value
  return discovery.canteens.map((c) => {
    const outlets = c.outlets.map((o) => {
      const open = outletTone(o) === 'open'
      return { o, open, crowd: open ? outletCrowd(o.id, t) : null, summary: open ? '' : outletSummary(o) }
    })
    const best = outlets.filter((x) => x.crowd).sort((a, b) => a.crowd!.waitMin - b.crowd!.waitMin)[0]
    return { c, best, summary: outlets[0]?.summary ?? '', wait: best?.crowd?.waitMin ?? Infinity }
  }).sort((a, b) => a.wait - b.wait)
})
</script>

<template>
  <div class="page home">
    <template v-if="hasMyMap">
      <button type="button" class="back-mine" @click="setMapView('mine')"><Ico name="back" />回到我的地图</button>
      <UpNextCard />
    </template>
    <section v-else class="invite">
      <span class="invite-icon"><Ico name="users" /></span>
      <span class="grow">
        <b>登录看你的专属地图</b>
        <small>课程和报名的活动自动标在地图上</small>
      </span>
      <button type="button" class="invite-go" @click="openAccount()">登录</button>
    </section>

    <section v-if="canteens.length" class="sec dining">
      <h3>食堂排队</h3>
      <ul class="list-plain">
        <li v-for="x in canteens" :key="x.c.id">
          <button type="button" class="canteen" @click="openDining(x.c.id)">
            <Ico name="dining" /><b class="ellipsis">{{ x.c.zh }}</b>
            <span v-if="x.best?.crowd" class="crowd" :class="`lv${x.best.crowd.level}`">{{ CROWD_LABELS[x.best.crowd.level] }}<small>约 {{ x.best.crowd.waitMin }} 分钟</small><em v-if="x.best.crowd.source === 'live'">实时</em></span>
            <span v-else class="closed ellipsis">{{ x.summary || '未营业' }}</span>
            <Ico name="chevron" class="chev" />
          </button>
        </li>
      </ul>
    </section>

    <!-- 手机没有左侧导航栏，快递站放这里 -->
    <button v-if="!ui.desktop" type="button" class="act small parcel-action" @click="openParcelStationMap()"><Ico name="parcel" />快递站地图</button>

    <footer class="foot">
      <p>底图、楼宇、点位来自上海科技大学校园地图；部分道路 © OpenStreetMap contributors · <a href="/admin/" target="_blank" rel="noopener">管理后台</a></p>
    </footer>
  </div>
</template>

<style scoped>
.home { flex: 1 0 auto; display: flex; flex-direction: column; padding-top: 6px; }
.dining { margin-top: 18px; }
.back-mine { align-self: flex-start; display: inline-flex; align-items: center; gap: 4px; height: 32px; margin: 0 0 8px -4px; padding: 0 10px 0 6px; border: 0; border-radius: 999px; background: none; color: var(--brand); font-size: 13.5px; font-weight: 650; cursor: pointer; }
.back-mine .svgi { font-size: 16px; }
.invite { display: flex; align-items: center; gap: 11px; padding: 10px 10px 10px 12px; border: 1px solid color-mix(in srgb, var(--brand) 18%, #fff); border-radius: 14px; background: var(--brand-soft); }
.invite-icon { flex: none; display: grid; place-items: center; width: 36px; height: 36px; border-radius: 11px; background: var(--brand); color: #fff; font-size: 18px; }
.invite b { display: block; font-size: 14.5px; font-weight: 700; color: var(--ink); }
.invite small { display: block; margin-top: 2px; font-size: 12px; color: var(--ink-2); }
.invite-go { flex: none; height: 34px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--brand); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
.invite-go:active { transform: scale(.96); }
.canteen { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 44px; padding: 6px; margin: 0 -6px; width: calc(100% + 12px); border: 0; border-radius: 10px; background: none; color: var(--ink); text-align: left; cursor: pointer; }
.canteen > .svgi:first-child { flex: none; width: 26px; height: 26px; padding: 5px; border-radius: 8px; background: #fff2e0; color: #ad6a19; }
.canteen b { flex: 1; min-width: 0; font-size: 14.5px; }
.chev { flex: none; color: var(--ink-3); }
li + li .canteen { border-top: 1px solid var(--line); border-radius: 0; }
.crowd { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px; border-radius: 999px; font-size: 12px; font-weight: 650; }
.crowd small { font-weight: 500; opacity: .8; }
.crowd em { padding: 0 5px; border-radius: 999px; background: #ffffffb0; font-size: 10.5px; font-style: normal; }
.crowd.lv0 { background: #e9f5ee; color: #1f7a48; }
.crowd.lv1 { background: #fff2e0; color: #a5620f; }
.crowd.lv2 { background: #fdebec; color: #b3261e; }
.closed { flex: none; max-width: 60%; color: var(--ink-3); font-size: 12px; }
@media (hover: hover) { .canteen:hover { background: #f7f7f9; } .back-mine:hover { background: var(--brand-soft); } }
.parcel-action { align-self: flex-start; margin-top: 16px; }
/* 版权固定在面板最下面：内容少时也贴底，内容多时跟在最后 */
.home > :nth-last-child(2) { margin-bottom: 28px; }
.foot { margin-top: auto; padding-bottom: 4px; padding-top: 12px; border-top: 1px solid var(--line); }
.foot p { color: var(--ink-3); font-size: 11px; line-height: 1.6; }
.foot a { color: var(--ink-3); text-decoration: underline; text-underline-offset: 2px; }
</style>
