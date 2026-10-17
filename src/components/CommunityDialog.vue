<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { community, communityApi as api, communityTime, preparePhoto, topicPath, type CommunityTarget, type CommunityUser, type CommunityPost, type CommunityComment, type CommunitySummary } from '../lib/community'
import Ico from './Ico.vue'
import ImagePreview from './ImagePreview.vue'
import { account, openAccount } from '../lib/account'
import { openProfile } from '../lib/profile'

const props = defineProps<{ target: CommunityTarget }>()
const path = topicPath(props.target)
const dialog = ref<HTMLElement>()
// 会话只用于浏览、点赞和收藏；公开署名用校园账号在「我的」里设置的昵称
const me = ref<CommunityUser | null>(null)
const canPublish = computed(() => !!account.me?.nameSet)
const publishHint = computed(() => !account.me ? '登录后' : '起个昵称后')
const posts = ref<CommunityPost[]>([]), total = ref(0), hasMore = ref(false)
const sort = ref('latest'), search = ref(''), query = ref('')
const loading = ref(true), error = ref(''), busy = ref(false), uploading = ref(false)
const view = ref<'feed' | 'compose' | 'post'>('feed')
const selected = ref<CommunityPost | null>(null), comments = ref<CommunityComment[]>([]), commentsMore = ref(false), commentsLoading = ref(false)
const comment = ref(''), reply = ref<CommunityComment | null>(null), commentInput = ref<HTMLTextAreaElement>()
const title = ref(''), content = ref(''), tag = ref('分享')
const images = ref<{ id: string; url: string }[]>([])
const fileInput = ref<HTMLInputElement>()
const summary = ref<CommunitySummary | null>(null), aiBusy = ref(false), aiError = ref(''), aiAvailable = ref(false), aiExpanded = ref(true)
const gallery = ref<string[]>([])
const pendingReactions = new Set<string>()
const draftDirty = computed(() => !!(title.value || content.value || images.value.length))
const tags = props.target.type === 'event' ? ['分享', '提问', '攻略', '约伴'] : props.target.type === 'place' ? ['测评', '攻略', '提问', '分享'] : ['分享', '测评', '提问', '攻略']
/** 各类交流区的标题和空状态文案 */
const COPY = {
  event: { eyebrow: '活动交流站', intro: '从一个问题开始，找到一起出发的人。', empty: '分享活动见闻、提出问题，或找个同伴一起去。' },
  stall: { eyebrow: '校园食味圈', intro: '今天吃什么？把你的宝藏发现留在这里。', empty: '晒一晒今日午餐，聊聊口味、分量和你的私藏吃法。' },
  place: { eyebrow: '地点点评', intro: '好不好用、什么时候人少，来过的同学说了算。', empty: '理发、自习、办事的体验，写下来帮下一个人少走弯路。' },
}
const previousFocus = document.activeElement as HTMLElement | null
watch(view, async () => {
  await nextTick()
  dialog.value?.querySelector('.community-scroll')?.scrollTo({ top: 0 })
})
let feedVersion = 0, commentVersion = 0, disposed = false
const message = (e: unknown) => e instanceof Error ? e.message : '操作失败，请稍后重试'
const avatarColor = (id: string) => ['#e6eee8', '#f5e6dc', '#e8e6f3', '#e1edf3'][id.charCodeAt(0) % 4]

async function loadFeed(more = false) {
  const version = ++feedVersion
  loading.value = true; error.value = ''
  try {
    const data = await api<{ posts: CommunityPost[]; total: number; hasMore: boolean }>(`${path}/posts?sort=${sort.value}&q=${encodeURIComponent(query.value)}&offset=${more ? posts.value.length : 0}`)
    if (version !== feedVersion || disposed) return
    posts.value = more ? [...posts.value, ...data.posts.filter(p => !posts.value.some(old => old.id === p.id))] : data.posts
    total.value = data.total; hasMore.value = data.hasMore
  } catch (e) { if (version === feedVersion) error.value = message(e) }
  finally { if (version === feedVersion) loading.value = false }
}
async function loadSummary() {
  try {
    const data = await api<{ summary: CommunitySummary | null; available: boolean }>(`${path}/summary`)
    summary.value = data.summary; aiAvailable.value = data.available; aiError.value = ''
  } catch (e) { aiError.value = message(e) }
}
async function init() {
  loading.value = true; error.value = ''
  try { me.value = await api<CommunityUser>('/session', 'POST'); await Promise.all([loadFeed(), loadSummary()]) }
  catch (e) { error.value = message(e); loading.value = false }
}
watch([sort, query], () => { if (me.value) void loadFeed() })
/** 没登录先登录，登录了没昵称先起昵称（同一个登录框里完成） */
function startCompose() {
  if (!canPublish.value) { openAccount(); return }
  view.value = 'compose'; error.value = ''
}
/** 昵称在「我的」里修改：关掉交流区再过去（有草稿会先确认） */
function goProfile() {
  if (!account.me?.nameSet) { openAccount(); return }
  close()
  if (!community.target) openProfile()
}
async function generateSummary() {
  if (aiBusy.value) return
  aiBusy.value = true; aiError.value = ''; aiExpanded.value = true
  try { summary.value = await api<CommunitySummary>(`${path}/summary`, 'POST') }
  catch (e) { aiError.value = message(e) } finally { aiBusy.value = false }
}
function updatePost(p: CommunityPost) {
  posts.value = posts.value.map(old => old.id === p.id ? p : old)
  if (selected.value?.id === p.id) selected.value = p
}
async function react(p: CommunityPost, kind: 'like' | 'save') {
  if (pendingReactions.has(p.id + kind)) return
  pendingReactions.add(p.id + kind); error.value = ''
  try {
    updatePost(await api<CommunityPost>(`/posts/${p.id}/reactions/${kind}`, 'PUT', { active: !(kind === 'like' ? p.liked : p.saved) }))
    if (sort.value === 'saved' && kind === 'save') await loadFeed()
  } catch (e) { error.value = message(e) } finally { pendingReactions.delete(p.id + kind) }
}
async function openPost(p: CommunityPost) {
  selected.value = p; view.value = 'post'; error.value = ''; comments.value = []; comment.value = ''; reply.value = null
  void loadComments()
  try { const latest = await api<CommunityPost>(`/posts/${p.id}`); updatePost(latest) } catch (e) { error.value = message(e) }
}
async function loadComments(more = false) {
  if (!selected.value) return
  const id = selected.value.id, version = ++commentVersion
  commentsLoading.value = true
  try {
    const data = await api<{ comments: CommunityComment[]; hasMore: boolean }>(`/posts/${id}/comments?offset=${more ? comments.value.length : 0}`)
    if (version === commentVersion && selected.value?.id === id) {
      comments.value = more ? [...comments.value, ...data.comments] : data.comments; commentsMore.value = data.hasMore
    }
  } catch (e) { error.value = message(e) } finally { if (version === commentVersion) commentsLoading.value = false }
}
async function sendComment() {
  if (!selected.value || busy.value || !comment.value.trim()) return
  busy.value = true; error.value = ''
  try {
    const c = await api<CommunityComment>(`/posts/${selected.value.id}/comments`, 'POST', { content: comment.value, parentId: reply.value?.id })
    comment.value = ''; reply.value = null; selected.value.comments++; if (summary.value) summary.value.stale = true
    // Reload paginated conversations to avoid skipping an older comment after a local append.
    if (commentsMore.value) await loadComments(); else comments.value.push(c)
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function replyTo(c: CommunityComment) { reply.value = c; await nextTick(); commentInput.value?.focus() }
async function deleteComment(c: CommunityComment) {
  if (busy.value || !confirm('删除这条评论？')) return
  busy.value = true; error.value = ''
  try {
    await api(`/comments/${c.id}`, 'DELETE'); if (selected.value) selected.value.comments--
    if (reply.value?.id === c.id) reply.value = null
    await Promise.all([loadComments(), loadSummary()])
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function deletePost() {
  if (!selected.value || busy.value || !confirm('删除这篇笔记及其全部评论？此操作无法撤销。')) return
  busy.value = true; error.value = ''
  try { await api(`/posts/${selected.value.id}`, 'DELETE'); selected.value = null; view.value = 'feed'; await Promise.all([loadFeed(), loadSummary()]) }
  catch (e) { error.value = message(e) } finally { busy.value = false }
}
async function uploadPhotos(event: Event) {
  const input = event.target as HTMLInputElement, files = [...(input.files || [])]
  input.value = ''
  if (!files.length || uploading.value) return
  if (images.value.length + files.length > 4) { error.value = '每篇笔记最多放 4 张图片'; return }
  uploading.value = true; error.value = ''
  try {
    for (const file of files) {
      const data = await preparePhoto(file)
      images.value.push(await api<{ id: string; url: string }>('/images', 'POST', { data }))
    }
  } catch (e) { error.value = message(e) } finally { uploading.value = false }
}
async function removePhoto(image: { id: string; url: string }) {
  try { await api(`/images/${image.id}`, 'DELETE'); images.value = images.value.filter(x => x.id !== image.id) }
  catch (e) { error.value = message(e) }
}
async function publish() {
  if (!canPublish.value) { openAccount(); return }
  if (busy.value || uploading.value || !title.value.trim() || !content.value.trim()) return
  busy.value = true; error.value = ''
  try {
    const p = await api<CommunityPost>(`${path}/posts`, 'POST', { title: title.value, content: content.value, tag: tag.value, images: images.value.map(i => i.id) })
    title.value = ''; content.value = ''; images.value = []; tag.value = '分享'
    sort.value = 'latest'; query.value = ''; search.value = ''
    if (summary.value) summary.value.stale = true
    await loadFeed(); await openPost(p)
  } catch (e) { error.value = message(e) } finally { busy.value = false }
}
function leaveEditor() {
  if (busy.value || uploading.value) return false
  if (draftDirty.value && !confirm('放弃这篇尚未发布的笔记？')) return false
  for (const image of images.value) void api(`/images/${image.id}`, 'DELETE').catch(() => {})
  title.value = ''; content.value = ''; images.value = []
  return true
}
function back() {
  if (busy.value || uploading.value) return
  if (view.value === 'compose' && !leaveEditor()) return
  if (comment.value.trim() && !confirm('放弃尚未发送的评论？')) return
  comment.value = ''; view.value = 'feed'; selected.value = null; error.value = ''; void loadFeed()
}
function close() {
  if (busy.value || uploading.value) return
  if (view.value === 'compose' && !leaveEditor()) return
  if (comment.value.trim() && !confirm('放弃尚未发送的评论？')) return
  community.target = null
}
function keydown(event: KeyboardEvent) {
  // 登录框盖在上面时把键盘交给它
  if (gallery.value.length || account.open) return
  if (event.key === 'Escape') { event.preventDefault(); close() }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = [...dialog.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled):not([type=hidden]), textarea:not(:disabled), [tabindex="0"]')].filter(el => el.getClientRects().length)
  const first = focusable[0], last = focusable.at(-1)
  if (event.shiftKey && (document.activeElement === first || !dialog.value.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && (document.activeElement === last || !dialog.value.contains(document.activeElement))) { event.preventDefault(); first?.focus() }
}
function unload(event: BeforeUnloadEvent) { if (draftDirty.value || comment.value.trim()) event.preventDefault() }
onMounted(() => { dialog.value?.focus(); document.addEventListener('keydown', keydown); window.addEventListener('beforeunload', unload); void init() })
onBeforeUnmount(() => { disposed = true; feedVersion++; document.removeEventListener('keydown', keydown); window.removeEventListener('beforeunload', unload); previousFocus?.focus() })
</script>

<template>
  <Teleport to="body">
    <div class="community-overlay" @click.self="close">
      <section ref="dialog" class="community-dialog" role="dialog" aria-modal="true" aria-labelledby="community-title" tabindex="-1">
        <header class="community-topbar">
          <div class="community-wordmark"><span><Ico name="chat" /></span><b>科大 · 同频</b><small>在校园，分享每一种体验</small></div>
          <div class="community-top-actions"><button v-if="account.me" type="button" class="community-profile" :class="{ todo: !account.me.nameSet }" :title="account.me.nameSet ? '在「我的」里修改昵称' : '起个昵称才能发笔记和评论'" @click="goProfile"><span class="community-avatar" :style="{ background: avatarColor(account.me.id) }">{{ account.me.nameSet ? account.me.name.slice(0, 1) : '?' }}</span><span>{{ account.me.nameSet ? account.me.name : '起个昵称' }}</span></button><button v-else type="button" class="community-login" @click="openAccount()">登录</button><button type="button" class="close" aria-label="关闭交流区" :disabled="busy || uploading" @click="close"><Ico name="close" /></button></div>
        </header>
        <div class="community-scroll">
          <div v-if="error" class="community-error" role="alert">{{ error }}<button v-if="!me" type="button" @click="init">重新连接</button><button v-else-if="view === 'feed'" type="button" @click="loadFeed()">重新加载</button></div>
          <template v-if="view === 'feed'">
            <section class="community-hero">
              <div><span class="community-eyebrow"><span />{{ COPY[target.type].eyebrow }}</span><h2 id="community-title">{{ target.name }}</h2><p>{{ target.subtitle || COPY[target.type].intro }}</p></div>
              <button type="button" class="community-publish" @click="startCompose"><Ico name="plus" />{{ canPublish ? '发笔记' : `${publishHint}发笔记` }}</button>
            </section>
            <section class="community-ai" aria-label="AI 总结">
              <div class="community-ai-head"><span class="community-ai-symbol"><Ico name="sparkles" /></span><div><b>先看 AI 划重点</b><small>DeepSeek · {{ summary ? '资料与同学讨论摘要' : '帮你快速了解这里' }}</small></div><button type="button" :disabled="aiBusy || !me || (!aiAvailable && !aiError)" @click="generateSummary"><Ico :name="aiBusy ? 'refresh' : 'sparkles'" :class="{ spinning: aiBusy }" />{{ aiBusy ? '正在整理…' : summary ? summary.stale ? '更新总结' : '查看最新' : '生成总结' }}</button><button v-if="summary" type="button" class="ai-collapse" :aria-expanded="aiExpanded" aria-label="展开或收起总结" @click="aiExpanded = !aiExpanded">{{ aiExpanded ? '−' : '+' }}</button></div>
              <template v-if="summary && aiExpanded"><p class="community-ai-overview">{{ summary.overview }}</p><ul v-if="summary.highlights.length"><li v-for="item in summary.highlights" :key="item">{{ item }}</li></ul><div v-if="summary.questions.length" class="community-ai-questions"><b>还想知道</b><p v-for="item in summary.questions" :key="item">{{ item }}</p></div><small class="community-ai-foot">{{ communityTime(summary.generatedAt) }} · 参考 {{ summary.sampled.posts }}/{{ summary.counts.posts }} 篇笔记、{{ summary.sampled.comments }}/{{ summary.counts.comments }} 条评论。AI 整理，仅供参考。<strong v-if="summary.stale">讨论有更新，建议重新总结。</strong></small></template>
              <p v-else-if="!summary" class="community-ai-hint">{{ !aiAvailable && !aiError ? 'AI 服务尚未配置，仍可正常发帖交流。' : '整理资料、讨论亮点与待解答问题。点击后会将本页文字交给 DeepSeek 总结。' }}</p>
              <p v-if="aiError" class="community-ai-error" role="alert">{{ aiError }}</p>
            </section>
            <div class="community-feed-tools"><nav aria-label="笔记排序"><button v-for="option in [{ id: 'latest', name: '最新发现' }, { id: 'hot', name: '热门讨论' }, { id: 'saved', name: '我的收藏' }]" :key="option.id" type="button" :class="{ active: sort === option.id }" :aria-pressed="sort === option.id" @click="sort = option.id">{{ option.name }}</button></nav><form class="community-search" role="search" @submit.prevent="query = search.trim()"><Ico name="search" /><input v-model="search" type="search" aria-label="搜索当前交流区笔记" placeholder="搜一搜这里的笔记" @input="!search && (query = '')" /><button type="submit" aria-label="搜索笔记"><Ico name="chevron" /></button></form></div>
            <p class="community-count">{{ query ? `“${query}” · ` : '' }}{{ total }} 篇笔记 <span>每一种真实体验，都值得被看见</span></p>
            <div v-if="loading && !posts.length" class="community-skeletons" role="status" aria-label="正在加载笔记"><div v-for="i in 4" :key="i" /></div>
            <div v-else-if="!posts.length && !error" class="community-empty"><span><Ico :name="sort === 'saved' ? 'bookmark' : 'chat'" /></span><h3>{{ query ? '还没有找到这篇笔记' : sort === 'saved' ? '喜欢的笔记，留着慢慢看' : '这里的第一篇，等你来写' }}</h3><p>{{ query ? '换个关键词，或看看其他同学的分享。' : sort === 'saved' ? '在笔记详情点一下收藏，就会出现在这里。' : COPY[target.type].empty }}</p><button v-if="!query && sort !== 'saved'" class="act primary" type="button" @click="startCompose">{{ canPublish ? '写下第一篇笔记' : `${publishHint}写笔记` }}</button></div>
            <div class="community-feed"><article v-for="p in posts" :key="p.id" class="community-note"><button type="button" class="community-note-main" @click="openPost(p)"><div v-if="p.images.length" class="community-note-cover"><img :src="p.images[0]" :alt="p.title" loading="lazy" /><span v-if="p.images.length > 1">{{ p.images.length }} 张</span></div><div v-else class="community-text-cover" :class="`tone-${p.tag}`"><span>{{ p.tag === '提问' ? '想问问大家' : p.tag === '约伴' ? '一起出发吧' : p.tag === '攻略' ? '我的校园小攻略' : '校园生活碎片' }}</span><p>{{ p.content }}</p><Ico :name="p.tag === '提问' ? 'chat' : 'book'" /></div><div class="community-note-copy"><span class="community-note-tag"># {{ p.tag }}</span><h3>{{ p.title }}</h3><p>{{ p.content }}</p></div></button><footer><span class="community-note-author"><span class="community-avatar" :style="{ background: avatarColor(p.author.id) }">{{ p.author.name.slice(0, 1) }}</span><span>{{ p.author.name }}</span><em v-if="p.attended" class="attended-badge">到场</em></span><button type="button" class="community-heart" :class="{ active: p.liked }" :aria-pressed="p.liked" :aria-label="`${p.liked ? '取消点赞' : '点赞'}：${p.title}`" @click="react(p, 'like')"><Ico name="heart" />{{ p.likes || '赞' }}</button></footer><small class="community-note-meta">{{ communityTime(p.createdAt) }} · {{ p.comments }} 条讨论</small></article></div>
            <button v-if="hasMore" class="more-button" type="button" :disabled="loading" @click="loadFeed(true)">{{ loading ? '加载中…' : '再看一些笔记' }}</button>
          </template>

          <template v-else-if="view === 'compose'">
            <button type="button" class="text-back" @click="back"><Ico name="back" />返回交流区</button>
            <div class="community-compose-heading"><span class="community-eyebrow">记录校园的每一种可能</span><h2 id="community-title">分享你的发现</h2><p>发布到 <b>{{ target.name }}</b></p></div>
            <form class="community-compose" @submit.prevent="publish">
              <div class="community-photo-grid"><div v-for="(image, i) in images" :key="image.id"><img :src="image.url" :alt="`待发布图片 ${i + 1}`" /><button type="button" :disabled="busy || uploading" :aria-label="`移除图片 ${i + 1}`" @click="removePhoto(image)"><Ico name="close" /></button><span v-if="i === 0">封面</span></div><button v-if="images.length < 4" class="community-photo-add" type="button" :disabled="uploading || busy" @click="fileInput?.click()"><Ico :name="uploading ? 'refresh' : 'image'" /><b>{{ uploading ? '正在上传…' : '添加照片' }}</b><small>{{ images.length }}/4 · 可选</small></button></div>
              <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden @change="uploadPhotos" />
              <label class="community-title-field"><span class="sr-only">笔记标题</span><input v-model="title" placeholder="一个标题，让你的发现被看见" maxlength="60" required :disabled="busy" /><small>{{ title.length }}/60</small></label>
              <label class="community-content-field"><span class="sr-only">笔记正文</span><textarea v-model="content" placeholder="聊聊真实体验，或者向大家提个问题…" maxlength="4000" rows="8" required :disabled="busy" /><small>{{ content.length }}/4000</small></label>
              <div class="community-tags"><span>给笔记选个话题</span><button v-for="t in tags" :key="t" type="button" :class="{ active: tag === t }" :aria-pressed="tag === t" @click="tag = t"># {{ t }}</button></div>
              <div class="community-compose-footer"><p>友善交流，分享真实体验。<br /><small>笔记公开可见，请勿填写手机号等私人信息。</small></p><button class="community-publish" :disabled="busy || uploading || !title.trim() || !content.trim() || !canPublish"><Ico name="edit" />{{ busy ? '发布中…' : '发布笔记' }}</button></div>
            </form>
          </template>

          <template v-else-if="selected">
            <button type="button" class="text-back" @click="back"><Ico name="back" />返回交流区</button>
            <article class="community-post-detail"><div class="community-post-author"><span class="community-avatar" :style="{ background: avatarColor(selected.author.id) }">{{ selected.author.name.slice(0, 1) }}</span><div><b>{{ selected.author.name }}</b><small>{{ communityTime(selected.createdAt) }} · {{ target.name }}</small></div><button v-if="selected.mine" type="button" :disabled="busy" class="community-delete" @click="deletePost">删除笔记</button></div><div v-if="selected.images.length" class="community-post-gallery"><button v-for="(url, i) in selected.images" :key="url" type="button" :aria-label="`放大笔记图片 ${i + 1}`" @click="gallery = [url, ...selected.images.filter(p => p !== url)]"><img :src="url" :alt="`${selected.title} · 图片 ${i + 1}`" /></button></div><span class="community-note-tag"># {{ selected.tag }}</span><h2 id="community-title">{{ selected.title }}</h2><p class="community-post-content">{{ selected.content }}</p><div class="community-post-actions"><button type="button" :class="{ active: selected.liked }" :aria-pressed="selected.liked" @click="react(selected, 'like')"><Ico name="heart" />{{ selected.liked ? '已赞' : '点赞' }} {{ selected.likes || '' }}</button><button type="button" :class="{ active: selected.saved }" :aria-pressed="selected.saved" @click="react(selected, 'save')"><Ico name="bookmark" />{{ selected.saved ? '已收藏' : '收藏' }}</button><span><Ico name="chat" />{{ selected.comments }} 条讨论</span></div></article>
            <section class="community-comments"><h3>一起聊聊 <span>{{ selected.comments }}</span></h3><form class="community-comment-form" @submit.prevent="sendComment"><div v-if="reply" class="community-reply-to">回复 {{ reply.author.name }}<button type="button" aria-label="取消回复" @click="reply = null"><Ico name="close" /></button></div><textarea ref="commentInput" v-model="comment" maxlength="1000" :disabled="busy || !canPublish" rows="2" aria-label="评论内容" :placeholder="canPublish ? '友善提问，认真分享…' : `${publishHint}参与评论`" required /><div><small>{{ comment.length }}/1000</small><button v-if="canPublish" class="act primary small" :disabled="busy || !comment.trim()">{{ busy ? '处理中…' : '发送评论' }}</button><button v-else type="button" class="act primary small" @click="openAccount()">{{ publishHint }}评论</button></div></form><p v-if="commentsLoading && !comments.length" class="empty" role="status">讨论加载中…</p><p v-else-if="!comments.length" class="community-no-comments">还没有评论，来开启这场对话吧。</p><article v-for="c in comments" :key="c.id" class="community-comment" :class="{ reply: c.parentId }"><span class="community-avatar" :style="{ background: avatarColor(c.author.id) }">{{ c.author.name.slice(0, 1) }}</span><div><b>{{ c.author.name }}<em v-if="c.author.id === selected.author.id">作者</em></b><p><span v-if="c.replyTo" class="community-reply-name">回复 {{ c.replyTo }}：</span>{{ c.content }}</p><footer><small>{{ communityTime(c.createdAt) }}</small><button type="button" @click="replyTo(c)">回复</button><button v-if="c.mine" type="button" :disabled="busy" @click="deleteComment(c)">删除</button></footer></div></article><button v-if="commentsMore" type="button" class="more-button" :disabled="commentsLoading" @click="loadComments(true)">{{ commentsLoading ? '加载中…' : '查看更多讨论' }}</button></section>
          </template>
          <footer class="community-bottom-note">上科大一图通 <span>·</span> 让每一个地点，多一点连接</footer>
        </div>
      </section>
    </div>
    <ImagePreview :photos="gallery" :title="selected?.title || '笔记图片'" @close="gallery = []" />
  </Teleport>
</template>

<style src="../lib/community.css"></style>
