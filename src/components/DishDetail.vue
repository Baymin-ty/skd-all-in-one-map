<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { MEAL_LABELS, outletText } from '../lib/campusTime'
import { dayHint, priceLong, scheduleText, TAG_LABELS, type MenuItem } from '../lib/menu'
import { navigateToPlace, openCanteen } from '../lib/store'
import CommunityEntry from './CommunityEntry.vue'
import { communityApi, dishCommunity, stallCommunity } from '../lib/community'
import DishThumb from './DishThumb.vue'
import Ico from './Ico.vue'
import ImagePreview from './ImagePreview.vue'
const props = defineProps<{ item: MenuItem }>()
defineEmits<{ close: [] }>()
const sourceLink = computed(() => /^https?:\/\//.test(props.item.d.source || '') ? props.item.d.source : '')
const gallery = ref<string[]>([])
const galleryTitle = ref('菜品实拍')
const rating = ref<{ average: number | null; count: number; mine: number | null }>({ average: null, count: 0, mine: null })
const ratingBusy = ref(false)
const ratingError = ref('')
const ratingId = computed(() => dishCommunity(props.item.c.id, props.item.o.id, props.item.d.id))
function preview(photos: string[], title: string) { gallery.value = photos; galleryTitle.value = title }
function viewStall(item: MenuItem) {
  openCanteen(item.c.id, item.o.id, item.s?.id)
}
async function loadRating() {
  try { rating.value = await communityApi<typeof rating.value>(`/dishes/${encodeURIComponent(ratingId.value)}/rating`) } catch { /* 菜品评分暂时不可用时不影响菜单浏览 */ }
}
async function setRating(value: number) {
  if (ratingBusy.value) return
  ratingBusy.value = true; ratingError.value = ''
  try {
    await communityApi('/session', 'POST')
    rating.value = await communityApi<typeof rating.value>(`/dishes/${encodeURIComponent(ratingId.value)}/rating`, 'PUT', { rating: value })
  } catch (error) { ratingError.value = error instanceof Error ? error.message : '评分失败，请稍后重试' } finally { ratingBusy.value = false }
}
onMounted(() => { void loadRating() })
</script>

<template>
  <div class="dish-detail">
    <button class="text-back" type="button" @click="$emit('close')"><Ico name="back" />返回菜单</button>
    <figure v-if="item.d.photo" class="dish-hero"><button type="button" :aria-label="`放大${item.d.zh}实拍`" @click="preview([item.d.photo], item.d.zh)"><img :src="item.d.photo" :alt="item.d.zh" /></button><figcaption>实拍<template v-if="item.d.photoDate"> · {{ item.d.photoDate.slice(0, 7).replace('-', '.') }}</template></figcaption></figure>
    <div class="row dish-heading"><DishThumb v-if="!item.d.photo" :d="item.d" :size="56" /><div><h2 class="title">{{ item.d.zh }}</h2><p v-if="item.d.en" class="sub">{{ item.d.en }}</p></div></div>
    <section class="dish-rating" aria-label="菜品评分"><div class="dish-rating-summary"><span class="dish-stars" aria-hidden="true"><span v-for="star in 5" :key="star" :class="{ filled: rating.average !== null && star <= Math.round(rating.average) }">★</span></span><b v-if="rating.average !== null">{{ rating.average.toFixed(1) }}</b><small v-if="rating.count">{{ rating.count }} 人评分</small><small v-else>暂无评分</small></div><div class="dish-rating-actions"><span>我的评分</span><button v-for="star in 5" :key="star" type="button" class="dish-star-button" :class="{ selected: rating.mine !== null && star <= rating.mine }" :disabled="ratingBusy" :aria-label="`${star} 星`" :aria-pressed="rating.mine === star" @click="setRating(star)">★</button></div><p v-if="ratingError" class="dish-rating-error" role="alert">{{ ratingError }}</p></section>
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
.dish-rating { margin: 4px 0 16px; padding: 12px 14px; border: 1px solid var(--line, #e9e0d9); border-radius: 14px; background: var(--bg-2, #faf7f4); }
.dish-rating-summary, .dish-rating-actions { display: flex; align-items: center; gap: 7px; }
.dish-rating-summary b { font-size: 15px; }
.dish-rating-summary small, .dish-rating-actions > span { color: var(--ink-3); font-size: 11px; }
.dish-stars { color: #d8c9bd; letter-spacing: 1px; }
.dish-stars .filled, .dish-star-button.selected { color: #e3a72f; }
.dish-rating-actions { margin-top: 8px; }
.dish-star-button { border: 0; padding: 0 1px; background: none; color: #d8c9bd; font-size: 19px; line-height: 1; cursor: pointer; }
.dish-star-button:disabled { cursor: wait; opacity: .6; }
.dish-rating-error { margin: 7px 0 0; color: #ad3e48; font-size: 11px; }
.dish-where { padding: 14px; border-radius: 14px; background: var(--bg-2); margin: 18px 0 10px; }
.dish-where small, .dish-where b { display: block; }
.dish-where small { font-size: 12px; color: var(--ink-3); margin-bottom: 4px; }
.dish-where p { font-size: 13px; margin: 4px 0 8px; }
</style>
