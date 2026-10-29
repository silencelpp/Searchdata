import { reactive } from 'vue'
import { useTones } from './tones'

export type AiTask = 'analyze' | 'draft' | 'summary'

export interface AiTopic {
  title: string
  desc?: string
  source?: string
  note?: string
  /** 原文链接：加入待发布队列时记为选题来源 */
  url?: string
}

export interface AiConfig {
  baseUrl: string
  model: string
  hasKey: boolean
  keyHint: string
}

export const PLATFORMS = [
  { id: 'wechat', name: '公众号' },
  { id: 'xiaohongshu', name: '小红书' },
  { id: 'video', name: '短视频口播' },
  { id: 'weibo', name: '微博' },
]

// 全局共享的 AI 面板状态
const state = reactive({
  open: false,
  settingsOpen: false,
  task: 'analyze' as AiTask,
  topic: null as AiTopic | null,
  platform: 'wechat',
  /** 生成初稿时选的文章类型 */
  tones: [] as string[],
  output: '',
  loading: false,
  error: '',
})

let controller: AbortController | null = null

async function run() {
  controller?.abort()
  controller = new AbortController()
  state.output = ''
  state.error = ''
  state.loading = true
  if (state.task === 'draft') useTones().save(state.tones)
  try {
    const res = await fetch('/api/ai/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: state.task, topic: state.topic, platform: state.platform, tones: state.tones }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? `请求失败 (${res.status})`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      state.output += decoder.decode(value, { stream: true })
    }
  } catch (e) {
    if ((e as Error).name !== 'AbortError') state.error = (e as Error).message
  } finally {
    state.loading = false
  }
}

function stop() {
  controller?.abort()
}

/** 生成初稿前要先选平台风格和文章类型，所以打开面板后不自动生成，等用户点「开始生成」 */
function start(task: AiTask, topic: AiTopic | null = null) {
  stop()
  state.task = task
  state.topic = topic
  state.open = true
  state.output = ''
  state.error = ''
  if (task === 'draft') state.tones = [...useTones().selected.value]
  else run()
}

function close() {
  stop()
  state.open = false
}

export function useAi() {
  return { state, start, run, stop, close }
}
