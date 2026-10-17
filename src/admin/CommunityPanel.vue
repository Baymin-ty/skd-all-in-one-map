<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import Ico from '../components/Ico.vue'
import { notify } from './store'
import { formatTime } from './eventPipeline'
import { deleteComment, deletePost, fetchComments, fetchPosts, type AdminComment, type AdminPost, type CommunityPage } from './adminApi'

// 讨论管理：活动、档口、地点下同学发的笔记与评论，管理员可以查看和删除不合适的内容。
const props = defineProps<{ topic?: { id: string; name: string } | null }>()
const emit = defineEmits<{ clearTopic: [] }>()
const TYPES = [{ id: '', label: '全部' }, { id: 'event', label: '活动' }, { id: 'stall', label: '档口' }, { id: 'place', label: '地点' }] as const
const TYPE_LABELS: Record<string, string> = { event: '活动', stall: '档口', place: '地点' }
const query = reactive({ type: '', q: '' })
const page = ref<CommunityPage | null>(null), loading = ref(false), error = ref('')
const selectedId = ref(''), comments = ref<AdminComment[]>([]), commentsLoading = ref(false)
const selected = computed(() => page.value?.posts.find((p) => p.id === selectedId.value) ?? null)
let searchTimer = 0

async function load(append = false) {
  loading.value = true; error.value = ''
  try {
    const next = await fetchPosts({ type: query.type, q: query.q.trim(), topic: props.topic?.id, offset: append ? page.value?.posts.length ?? 0 : 0 })
    page.value = append && page.value ? { ...next, posts: [...page.value.posts, ...next.posts] } : next
    if (!append && !page.value.posts.some((p) => p.id === selectedId.value)) selectedId.value = page.value.posts[0]?.id ?? ''
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
}
watch(() => query.type, () => load())
watch(() => query.q, () => { window.clearTimeout(searchTimer); searchTimer = window.setTimeout(() => load(), 300) })
watch(() => props.topic?.id, () => load())
watch(selectedId, async (id) => {
  comments.value = []
  if (!id) return
  commentsLoading.value = true
  try { const list = await fetchComments(id); if (selectedId.value === id) comments.value = list }
  catch (e) { notify((e as Error).message, 'error') }
  finally { commentsLoading.value = false }
})
onMounted(() => load())

async function removePost(post: AdminPost) {
  if (!confirm(`删除笔记「${post.title}」？它的 ${post.comments} 条评论和图片会一起删除，无法撤销。`)) return
  try {
    await deletePost(post.id)
    if (page.value) {
      const index = page.value.posts.findIndex((p) => p.id === post.id)
      page.value.posts.splice(index, 1); page.value.total--
      if (page.value.stats.posts) page.value.stats.posts--
      selectedId.value = page.value.posts[Math.min(index, page.value.posts.length - 1)]?.id ?? ''
    }
    notify('笔记已删除')
  } catch (e) { notify((e as Error).message, 'error') }
}
async function removeComment(comment: AdminComment) {
  if (!confirm('删除这条评论？回复它的评论会保留。')) return
  try {
    await deleteComment(comment.id)
    comments.value = comments.value.filter((c) => c.id !== comment.id)
    if (selected.value) selected.value.comments--
    notify('评论已删除')
  } catch (e) { notify((e as Error).message, 'error') }
}
const replyTo = (id: string | null) => id ? comments.value.find((c) => c.id === id)?.author.name : ''
</script>

<template>
  <div class="community">
    <div class="community-stats">
      <div><small>笔记</small><b>{{ page?.stats.posts ?? '—' }}</b><span>活动 {{ page?.stats.byType?.event ?? 0 }} · 档口 {{ page?.stats.byType?.stall ?? 0 }} · 地点 {{ page?.stats.byType?.place ?? 0 }}</span></div>
      <div><small>评论</small><b>{{ page?.stats.comments ?? '—' }}</b><span>笔记下的全部回复</span></div>
      <div><small>最近 24 小时</small><b>{{ page?.stats.today ?? '—' }}</b><span>新发的笔记和评论</span></div>
    </div>

    <div class="community-columns">
      <section class="data-card post-list" aria-label="笔记列表">
        <div class="catalog-filters">
          <div class="kind-filters">
            <button v-for="t in TYPES" :key="t.id" :class="{ active: query.type === t.id }" :aria-pressed="query.type === t.id" @click="query.type = t.id">{{ t.label }}<span v-if="t.id">{{ page?.stats.byType?.[t.id] ?? 0 }}</span></button>
          </div>
          <div class="search-field"><Ico name="search" /><input v-model="query.q" type="search" placeholder="搜索标题、正文或话题…" aria-label="搜索讨论" /></div>
          <div v-if="topic" class="topic-filter"><span>只看：{{ topic.name }}</span><button class="icon-button" aria-label="取消只看这个话题" @click="emit('clearTopic')"><Ico name="close" /></button></div>
        </div>
        <div class="post-scroll">
          <div v-if="error" class="empty-state"><b>读取失败</b><p>{{ error }}</p><button class="button secondary" @click="load()">重试</button></div>
          <p v-else-if="loading && !page" class="empty-state">正在读取讨论…</p>
          <div v-else-if="!page?.posts.length" class="empty-state"><Ico name="chat" /><b>{{ query.q || topic ? '没有找到相关笔记' : '还没有同学发帖' }}</b><p>同学在活动、档口和地点详情里发的笔记会出现在这里。</p></div>
          <button v-for="p in page?.posts" :key="p.id" class="post-row" :class="{ active: p.id === selectedId }" :aria-pressed="p.id === selectedId" @click="selectedId = p.id">
            <span class="post-top"><em :class="p.topic.type">{{ TYPE_LABELS[p.topic.type] ?? p.topic.type }}</em><span>{{ p.topic.name }}</span></span>
            <b>{{ p.title }}</b>
            <small>{{ p.author.name }} · {{ formatTime(p.createdAt) }} · {{ p.comments }} 评论 · {{ p.likes }} 赞<template v-if="p.images.length"> · {{ p.images.length }} 图</template></small>
          </button>
          <button v-if="page?.hasMore" class="text-button more" :disabled="loading" @click="load(true)">加载更多（共 {{ page.total }} 篇）</button>
        </div>
      </section>

      <section v-if="selected" class="data-card post-detail" aria-label="笔记详情">
        <header class="editor-head">
          <div class="editor-title"><span class="dialog-eyebrow">{{ TYPE_LABELS[selected.topic.type] }} · {{ selected.topic.name }}</span><h2>{{ selected.title }}</h2><p class="byline">{{ selected.author.name }} · {{ formatTime(selected.createdAt) }} · #{{ selected.tag }} · {{ selected.likes }} 赞</p></div>
          <button class="button secondary danger-outline" @click="removePost(selected)"><Ico name="trash" />删除笔记</button>
        </header>
        <div class="post-body">
          <p>{{ selected.content }}</p>
          <div v-if="selected.images.length" class="post-images"><a v-for="src in selected.images" :key="src" :href="src" target="_blank" rel="noopener"><img :src="src" alt="笔记图片" loading="lazy" /></a></div>
        </div>
        <section class="comment-list">
          <h3>评论<small>{{ comments.length }}</small></h3>
          <p v-if="commentsLoading" class="muted">正在读取…</p>
          <p v-else-if="!comments.length" class="muted">还没有评论。</p>
          <article v-for="c in comments" :key="c.id" class="comment-row" :class="{ reply: c.parentId }">
            <div><small><b>{{ c.author.name }}</b><template v-if="replyTo(c.parentId)"> 回复 {{ replyTo(c.parentId) }}</template> · {{ formatTime(c.createdAt) }}</small><p>{{ c.content }}</p></div>
            <button class="icon-button danger" title="删除评论" aria-label="删除评论" @click="removeComment(c)"><Ico name="trash" /></button>
          </article>
        </section>
      </section>
      <section v-else class="data-card post-detail empty"><div class="empty-state"><Ico name="chat" /><b>选择一篇笔记查看详情</b><p>可以查看完整内容、图片和评论，删除不合适的内容。</p></div></section>
    </div>
  </div>
</template>

<style scoped>
.community { display: grid; gap: 16px; }
.community-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; border: 1px solid var(--line); border-radius: 10px; background: var(--line); overflow: hidden; }
.community-stats > div { display: flex; flex-direction: column; gap: 3px; padding: 14px 20px; background: #fff; }
.community-stats small { color: var(--muted); font-size: 12px; }
.community-stats b { color: #1f3d30; font-size: 24px; font-weight: 650; }
.community-stats span { color: #7a877f; font-size: 12px; }
.community-columns { display: grid; grid-template-columns: minmax(300px, 400px) minmax(0, 1fr); gap: 18px; align-items: start; }
.post-list { display: flex; flex-direction: column; height: calc(100dvh - 330px); min-height: 440px; }
.catalog-filters { flex: none; display: grid; gap: 10px; padding: 14px; border-bottom: 1px solid var(--line); }
.catalog-filters .kind-filters { margin: 0; }
.topic-filter { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 4px 4px 4px 10px; border-radius: 7px; background: #e9f1fb; color: #3266a8; font-size: 12px; }
.topic-filter span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topic-filter .icon-button { width: 24px; height: 24px; font-size: 13px; }
.post-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 6px 8px 12px; scrollbar-width: thin; }
.post-row { display: grid; gap: 3px; width: 100%; padding: 10px; border: 1px solid transparent; border-radius: 8px; background: #fff; text-align: left; }
.post-row:hover { background: #f6f8f5; }
.post-row.active { background: #edf5ef; border-color: #d2e3d6; }
.post-row b { font-size: 13px; font-weight: 550; }
.post-row small { color: #8a988e; font-size: 11px; }
.post-top { display: flex; align-items: center; gap: 6px; min-width: 0; color: #7a877f; font-size: 11px; }
.post-top span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.post-top em, .post-row em { flex: none; padding: 0 6px; border-radius: 4px; background: #eef2ef; color: #5b6f62; font-size: 10.5px; font-style: normal; line-height: 18px; }
em.event { background: #fbefd3; color: #8a6420; }
em.stall { background: #fdeee4; color: #a1532a; }
em.place { background: #e8f3ee; color: #28634e; }
.more { display: flex; width: 100%; padding: 12px 0; }
.post-detail { position: sticky; top: 14px; max-height: calc(100dvh - 330px); min-height: 440px; overflow-y: auto; scrollbar-width: thin; }
.post-detail.empty { display: grid; place-items: center; }
.editor-head { display: flex; align-items: flex-start; gap: 12px; padding: 18px 20px 14px; border-bottom: 1px solid var(--line); }
.editor-title { flex: 1; min-width: 0; }
.editor-title .dialog-eyebrow { margin-bottom: 4px; }
.editor-title h2 { font-size: 17px; line-height: 1.45; }
.byline { margin-top: 4px; color: #8a988e; font-size: 12px; }
.danger-outline:hover:not(:disabled) { color: #a33a36 !important; border-color: #d9a49e !important; background: #fff6f4 !important; }
.post-body { padding: 16px 20px; }
.post-body > p { color: #34493e; font-size: 13.5px; line-height: 1.85; white-space: pre-wrap; overflow-wrap: anywhere; }
.post-images { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; margin-top: 14px; }
.post-images img { display: block; width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
.comment-list { padding: 14px 20px 20px; border-top: 1px solid var(--line); background: #fafbfa; }
.comment-list h3 { display: flex; align-items: baseline; gap: 6px; margin-bottom: 4px; font-size: 13px; }
.comment-list h3 small { color: #8b998f; font-weight: 400; }
.muted { color: var(--muted); font-size: 12px; }
.comment-row { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-top: 1px solid #edf1ee; }
.comment-row.reply { padding-left: 18px; }
.comment-row > div { flex: 1; min-width: 0; }
.comment-row small { color: #8a988e; font-size: 11px; }
.comment-row small b { color: #4f6155; font-weight: 600; }
.comment-row p { margin-top: 3px; color: #34493e; font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 1000px) {
  .community-columns { grid-template-columns: 1fr; }
  .post-list { height: 420px; min-height: 0; }
  .post-detail { position: static; max-height: none; min-height: 0; }
}
@media (max-width: 680px) { .community-stats { grid-template-columns: 1fr; } }
</style>
