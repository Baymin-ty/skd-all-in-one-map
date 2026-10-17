import express from 'express'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_OUTPUT_TOKENS = 8192
const MODEL = 'deepseek-flash'
function visionEndpoint() {
  return process.env.SCHEDULE_VISION_URL || `${(process.env.SCHEDULE_VISION_BASE_URL || 'https://api.deepseek.com').replace(/\/$/, '')}/chat/completions`
}

function parseImage(value) {
  if (typeof value !== 'string') throw new Error('请上传课表图片')
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/)
  if (!match) throw new Error('只支持 JPG、PNG 或 WebP 课表图片')
  const bytes = Buffer.from(match[2], 'base64')
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error('课表图片不能超过 4 MB')
  return value
}
function jsonCandidates(text) {
  const candidates = []
  const add = (value) => { const trimmed = value.trim(); if (trimmed && !candidates.includes(trimmed)) candidates.push(trimmed) }
  add(text)
  for (const match of text.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)) add(match[1])
  for (let start = 0; start < text.length; start++) {
    if (text[start] !== '{') continue
    let depth = 0, inString = false, escaped = false
    for (let index = start; index < text.length; index++) {
      const char = text[index]
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
        continue
      }
      if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) { add(text.slice(start, index + 1)); break }
    }
  }
  return candidates
}
function parseJson(content, { truncated = false } = {}) {
  const text = typeof content === 'string' ? content.trim() : ''
  if (!text) throw new Error('识别服务返回为空，请稍后重试')
  if (truncated) throw new Error('识别服务输出过短，课表 JSON 被截断，请重试')
  let parsedJson = false, value
  for (const candidate of jsonCandidates(text)) {
    try {
      const parsed = JSON.parse(candidate)
      parsedJson = true
      if (parsed && Array.isArray(parsed.classes)) { value = parsed; break }
    } catch { /* try the next JSON-looking fragment */ }
  }
  if (!value) throw new Error(parsedJson ? '模型返回的课表格式不正确' : '识别结果不是有效 JSON')
  const classes = value.classes.map((item) => ({
    title: typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '',
    weekday: Number(item.weekday),
    start: typeof item.start === 'string' && /^\d\d:\d\d$/.test(item.start) ? item.start : '',
    end: typeof item.end === 'string' && /^\d\d:\d\d$/.test(item.end) ? item.end : '',
    room: typeof item.room === 'string' ? item.room.trim().slice(0, 80) : '',
    weeks: Array.isArray(item.weeks) ? item.weeks.filter((x) => Number.isInteger(x) && x > 0 && x < 60) : undefined,
    teacher: typeof item.teacher === 'string' ? item.teacher.trim().slice(0, 80) : undefined,
  })).filter((item) => item.title && item.weekday >= 1 && item.weekday <= 7)
  return { classes, warnings: Array.isArray(value.warnings) ? value.warnings.filter((x) => typeof x === 'string').slice(0, 20) : [] }
}
export async function parseScheduleImage(image, { fetcher = fetch, apiKey = process.env.SCHEDULE_VISION_API_KEY || process.env.DEEPSEEK_API_KEY, model = process.env.SCHEDULE_VISION_MODEL || MODEL, timeoutMs = 30_000 } = {}) {
  const data = parseImage(image)
  if (!apiKey) throw new Error('课表识别服务尚未配置')
  const prompt = '请识别这张上海科技大学教务系统课表截图，只返回 JSON：{"classes":[{"title":"课程名","weekday":1,"start":"08:00","end":"09:40","room":"1A-108","weeks":[1,2],"teacher":""}],"warnings":[]}。不要添加 Markdown 代码块或解释文字。weekday 用 1-7 表示周一到周日，时间必须是 HH:MM；看不清的字段留空并在 warnings 说明，不要编造。'
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const retryPrompt = attempt ? `${prompt} 上一次没有返回内容，请这次直接输出完整 JSON，即使看不清也返回 classes 数组和 warnings 数组。` : prompt
      const response = await fetcher(visionEndpoint(), { method: 'POST', signal: controller.signal, headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model, temperature: 0, max_tokens: MAX_OUTPUT_TOKENS, thinking: { type: 'disabled' }, messages: [{ role: 'user', content: [{ type: 'text', text: retryPrompt }, { type: 'image_url', image_url: { url: data } }] }] }) })
      const body = await response.json().catch(() => null)
      if (!response.ok) throw new Error(body?.error?.message || `识别服务返回 ${response.status}`)
      const choice = body?.choices?.[0]
      try { return parseJson(choice?.message?.content, { truncated: choice?.finish_reason === 'length' }) }
      catch (error) {
        if (attempt === 0 && error instanceof Error && /返回为空|输出过短/.test(error.message)) continue
        throw error
      }
    }
    throw new Error('识别服务返回为空，请稍后重试')
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('课表识别超时，请稍后重试')
    if (error instanceof SyntaxError) throw new Error('识别结果不是有效 JSON')
    throw error
  } finally { clearTimeout(timer) }
}

export function installSchedule(app) {
  const hits = new Map()
  const router = express.Router()
  router.use(express.json({ limit: '6mb' }))
  router.post('/parse', async (req, res) => {
    const ip = req.ip || 'unknown', now = Date.now(), old = hits.get(ip)
    if (!old || old.until <= now) hits.set(ip, { count: 1, until: now + 60_000 })
    else if (old.count >= 3) return res.status(429).json({ error: '识别请求过于频繁，请稍后再试' })
    else old.count++
    try { res.json(await parseScheduleImage(req.body?.image)) }
    catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : '课表识别失败' }) }
  })
  app.use('/api/schedule', router)
}

export { MAX_BYTES, MODEL }
