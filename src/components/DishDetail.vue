<script setup lang="ts">
import { computed, ref } from 'vue'
import { MEAL_LABELS, outletText } from '../lib/campusTime'
import { dayHint, priceLong, scheduleText, TAG_LABELS, type MenuItem } from '../lib/menu'
import { navigateToPlace, openCanteen } from '../lib/store'
import CommunityEntry from './CommunityEntry.vue'
import { stallCommunity } from '../lib/community'
import DishThumb from './DishThumb.vue'
import Ico from './Ico.vue'
import ImagePreview from './ImagePreview.vue'
const props = defineProps<{ item: MenuItem }>()
defineEmits<{ close: [] }>()
const sourceLink = computed(() => /^https?:\/\//.test(props.item.d.source || '') ? props.item.d.source : '')
const gallery = ref<string[]>([])
const galleryTitle = ref('菜品实拍')
function preview(photos: string[], title: string) { gallery.value = photos; galleryTitle.value = title }
function viewStall(item: MenuItem) {
  openCanteen(item.c.id, item.o.id, item.s?.id)
}
</script>

<template>
  <div class="dish-detail">
    <button class="text-back" type="button" @click="$emit('close')"><Ico name="back" />返回菜单</button>
    <figure v-if="item.d.photo" class="dish-hero"><button type="button" :aria-label="`放大${item.d.zh}实拍`" @click="preview([item.d.photo], item.d.zh)"><img :src="item.d.photo" :alt="item.d.zh" /></button><figcaption>实拍<template v-if="item.d.photoDate"> · {{ item.d.photoDate.slice(0, 7).replace('-', '.') }}</template></figcaption></figure>
    <div class="row dish-heading"><DishThumb v-if="!item.d.photo" :d="item.d" :size="56" /><div><h2 class="title">{{ item.d.zh }}</h2><p v-if="item.d.en" class="sub">{{ item.d.en }}</p></div></div>
    <p class="dish-price">{{ priceLong(item.d) }}</p>
    <div class="tags"><span v-if="item.d.soldOut" class="pill">已售罄</span><span v-for="tag in item.d.tags" :key="tag" class="pill food-tag">{{ TAG_LABELS[tag] || tag }}</span><span v-for="meal in item.d.meals" :key="meal" class="pill">{{ MEAL_LABELS[meal] }}</span></div>
    <p v-if="item.d.desc" class="note">{{ item.d.desc.zh }}</p>
    <p v-if="item.d.days" class="source-note">供应安排：{{ scheduleText(item.d) }}<br /><b>{{ dayHint(item.d, item.s)?.text }}</b></p>
    <div class="dish-where"><small>在哪里吃</small><b>{{ item.c.zh }} · {{ item.o.zh }}</b><p>{{ item.o.floor }}<template v-if="item.d.stall"> · {{ item.d.stall }}</template></p><span class="pill">{{ outletText(item.o) }}</span><p v-if="item.s?.note" class="source-note">{{ item.s.note.zh }}</p><p v-if="item.o.menuDate" class="source-note">菜单记录于 {{ item.o.menuDate }}</p></div>
    <div class="actions wrap-actions"><button type="button" class="act primary" @click="navigateToPlace(item.c.place, { name: item.c.zh, point: item.c.pos })"><Ico name="walk" />到这去</button><button type="button" class="act" @click="viewStall(item)"><Ico name="book" />查看这个窗口</button></div>
    <button v-if="item.s?.photos?.length" type="button" class="more-button" @click="preview(item.s.photos, `${item.d.stall} · 菜单原图`)"><Ico name="book" /> 菜单原图 · {{ item.s.photos.length }} 张</button>
    <CommunityEntry v-if="item.s" :target="{ type: 'stall', id: stallCommunity(item.c.id, item.o.id, item.s.id), name: item.s.zh, subtitle: item.c.zh + ' · ' + item.o.zh }" />
    <p class="source-note">价格、供餐时段来自菜单记录，请以窗口当天实际供应为准。</p>
    <p v-if="item.d.source" class="source-note">菜单来源：<a v-if="sourceLink" :href="sourceLink" target="_blank" rel="noopener noreferrer">查看网上菜单来源</a><span v-else>{{ item.d.source }}</span></p>
    <ImagePreview :photos="gallery" :title="galleryTitle" @close="gallery = []" />
  </div>
</template>

<style scoped>
.dish-hero { position: relative; margin: 14px 0; border-radius: 14px; overflow: hidden; background: var(--bg-2); }
.dish-hero img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; }
.dish-hero button { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.dish-hero figcaption { position: absolute; bottom: 8px; left: 8px; background: #0008; color: #fff; font-size: 11px; padding: 2px 7px; border-radius: 6px; }
.dish-heading { margin: 14px 0 8px; }
.dish-price { color: var(--brand); font-size: 17px; font-weight: 700; margin-bottom: 12px; }
.dish-where { padding: 14px; border-radius: 14px; background: var(--bg-2); margin: 18px 0 10px; }
.dish-where small, .dish-where b { display: block; }
.dish-where small { font-size: 12px; color: var(--ink-3); margin-bottom: 4px; }
.dish-where p { font-size: 13px; margin: 4px 0 8px; }
</style>
