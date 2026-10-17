import { describe, expect, it, vi } from 'vitest'
import { MAX_BYTES, parseScheduleImage } from './schedule.mjs'

const image = `data:image/png;base64,${Buffer.from('not-a-real-png-but-a-bounded-fixture').toString('base64')}`
const response = (content, status = 200) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { 'Content-Type': 'application/json' } })

describe('schedule vision parser', () => {
  it('sends a bounded image and validates the structured class response', async () => {
    const fetcher = vi.fn(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(request.model).toBe('deepseek-flash')
      expect(request.response_format).toEqual({ type: 'json_object' })
      expect(request.messages[0].content[1].image_url.url).toBe(image)
      return response(JSON.stringify({ classes: [{ title: '算法导论', weekday: 2, start: '08:00', end: '09:40', room: '1A-108', weeks: [1, 2], teacher: '李老师' }], warnings: [] }))
    })
    await expect(parseScheduleImage(image, { fetcher, apiKey: 'test-key' })).resolves.toEqual({
      classes: [{ title: '算法导论', weekday: 2, start: '08:00', end: '09:40', room: '1A-108', weeks: [1, 2], teacher: '李老师' }], warnings: [],
    })
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('extracts JSON when the model wraps it in explanatory text or a code fence', async () => {
    const content = '识别结果如下：\n```json\n{"classes":[{"title":"人工智能","weekday":1,"start":"08:15","end":"09:00","room":"1D106"}],"warnings":[]}\n```\n以上。'
    await expect(parseScheduleImage(image, { apiKey: 'test-key', fetcher: async () => response(content) })).resolves.toEqual({
      classes: [{ title: '人工智能', weekday: 1, start: '08:15', end: '09:00', room: '1D106', weeks: undefined, teacher: undefined }], warnings: [],
    })
  })

  it('rejects missing keys, oversized images and malformed model JSON', async () => {
    await expect(parseScheduleImage(image, { apiKey: '' })).rejects.toThrow('尚未配置')
    const oversized = `data:image/png;base64,${Buffer.alloc(MAX_BYTES + 1).toString('base64')}`
    await expect(parseScheduleImage(oversized, { apiKey: 'test-key' })).rejects.toThrow('不能超过 4 MB')
    await expect(parseScheduleImage(image, { apiKey: 'test-key', fetcher: async () => response('{bad') })).rejects.toThrow('有效 JSON')
  })

  it('turns an upstream timeout into a readable error', async () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' })
    await expect(parseScheduleImage(image, { apiKey: 'test-key', fetcher: async () => { throw error } })).rejects.toThrow('超时')
  })
})
