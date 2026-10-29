/**
 * 一键生成：给一个题材（可以不填），自动扫全网热榜 → AI 挑出合适的热点 → 逐篇写成文章，放进「我的文章」。
 * 只写到文章为止，不会自动发布。后台执行，前端轮询进度；同一时间只跑一个任务。
 */
import { randomUUID } from 'node:crypto'
import { buildPrompt, chat, getConfig } from './ai.js'
import { extractJson } from './ai-edit.js'
import { splitDraft } from '../shared/markdown.js'
import { getHot, hotSources } from './hot.js'
import { createPost, isPlatform, type PlatformId } from './posts.js'
import { TEMPLATES } from './writing.js'

export interface AutoArticle {
  topic: string
  source: string
  angle: string
  status: 'waiting' | 'writing' | 'done' | 'error'
  postId?: string
  title?: string
  error?: string
}

export interface AutoJob {
  id: string
  theme: string
  count: number
  stage: 'scanning' | 'picking' | 'writing' | 'done' | 'error' | 'cancelled'
  message: string
  articles: AutoArticle[]
  startedAt: number
  error?: string
}

let job: AutoJob | null = null
let abort: AbortController | null = null

export const getAutoJob = () => job

export function cancelAutoJob() {
  if (job && !['done', 'error', 'cancelled'].includes(job.stage)) abort?.abort()
}

interface HotLine {
  id: number
  title: string
  source: string
  url: string
  desc?: string
}

/** 让 AI 从热榜里挑出最合适的几个，每个给一个切入角度和最合适的结构 */
async function pickTopics(theme: string, count: number, lines: HotLine[], signal: AbortSignal) {
  const list = lines.map((l) => `${l.id}. [${l.source}] ${l.title}`).join('\n')
  const tpl = TEMPLATES.map((t) => `${t.id}（${t.name}：${t.desc}）`).join('、')
  const prompt = `下面是今天各平台的热榜，每行前面是编号：

${list}

${theme ? `我的账号写「${theme}」相关的内容。请挑出和这个题材最相关、最适合写成文章的 ${count} 个热点。如果相关的不够，可以挑能从这个题材角度切入的热点，但不要硬凑。` : `请挑出今天最适合写成自媒体文章的 ${count} 个热点。`}

挑选时避开：时政外交、灾难伤亡、未成年人隐私、明显时效只有几小时的。同一件事在多个平台上榜只算一个。

每个热点给一个具体的切入角度（一句话，说清楚从什么角度写、写给谁看），并从这些结构里选一个最合适的：${tpl}

只输出一个 JSON 数组，不要其他文字：
[{"id": 编号, "angle": "切入角度", "template": "结构 id"}]`
  const picked = extractJson<{ id?: unknown; angle?: unknown; template?: unknown }[]>(await chat(prompt, signal))
  if (!Array.isArray(picked)) throw new Error('AI 返回的格式不对，请重试')
  const seen = new Set<number>()
  return picked
    .map((p) => ({ line: lines.find((l) => l.id === Number(p.id)), angle: String(p.angle ?? ''), template: String(p.template ?? '') }))
    .filter((p): p is { line: HotLine; angle: string; template: string } => {
      if (!p.line || seen.has(p.line.id)) return false
      seen.add(p.line.id)
      return true
    })
    .slice(0, count)
}

export async function startAutoJob(input: Record<string, unknown>): Promise<AutoJob> {
  if (job && ['scanning', 'picking', 'writing'].includes(job.stage)) throw new Error('上一次还在生成，请等它完成或先停止')
  if (!(await getConfig()).apiKey) throw new Error('还没有配置 AI，请先点右上角「AI 设置」填写 API Key')
  const theme = String(input.theme ?? '').trim().slice(0, 50)
  const count = Math.min(5, Math.max(1, Number(input.count) || 3))
  const platforms = (Array.isArray(input.platforms) ? input.platforms.filter(isPlatform) : []) as PlatformId[]
  if (!platforms.length) platforms.push('wechat')
  const tones = Array.isArray(input.tones) ? input.tones : []
  const style = platforms[0] === 'xiaohongshu' ? 'xiaohongshu' : platforms[0]

  abort = new AbortController()
  const signal = abort.signal
  const current: AutoJob = { id: randomUUID(), theme, count, stage: 'scanning', message: '正在扫描 6 个平台的热榜…', articles: [], startedAt: Date.now() }
  job = current

  ;(async () => {
    try {
      // 1. 扫热榜
      const results = await Promise.all(hotSources.map((s) => getHot(s.id)))
      let n = 0
      const lines: HotLine[] = results.flatMap((r) =>
        r.items.slice(0, 20).map((i) => ({ id: ++n, title: i.title, source: r.name, url: i.url, desc: i.desc })),
      )
      if (!lines.length) throw new Error('热榜暂时获取不到，请稍后再试')
      if (signal.aborted) throw new DOMException('', 'AbortError')

      // 2. 挑选题
      current.stage = 'picking'
      current.message = `扫到 ${lines.length} 条热点，AI 正在挑选${theme ? `和「${theme}」相关的` : '最值得写的'}…`
      const picked = await pickTopics(theme, count, lines, AbortSignal.any([signal, AbortSignal.timeout(3 * 60_000)]))
      if (!picked.length) throw new Error(theme ? `今天热榜里没有找到和「${theme}」相关的热点，换个题材或者留空试试` : 'AI 没有挑出合适的热点，请重试')
      current.articles = picked.map((p) => ({ topic: p.line.title, source: p.line.source, angle: p.angle, status: 'waiting' }))

      // 3. 逐篇写
      current.stage = 'writing'
      for (let i = 0; i < picked.length; i++) {
        if (signal.aborted) break
        const p = picked[i]
        const a = current.articles[i]
        a.status = 'writing'
        current.message = `正在写第 ${i + 1} / ${picked.length} 篇`
        try {
          const prompt = await buildPrompt({
            task: 'draft',
            platform: style,
            tones,
            template: TEMPLATES.some((t) => t.id === p.template) ? p.template : '',
            topic: { title: p.line.title, source: p.line.source, desc: p.line.desc, note: `切入角度：${p.angle}${theme ? `。我的账号写「${theme}」相关内容。` : ''}` },
          })
          const md = await chat(prompt, AbortSignal.any([signal, AbortSignal.timeout(3 * 60_000)]))
          if (!md.trim()) throw new Error('AI 没有返回内容')
          const { title, content } = splitDraft(md, p.line.title)
          const post = await createPost({ title, content, platforms, source: { title: p.line.title, url: p.line.url } })
          a.status = 'done'
          a.postId = post.id
          a.title = post.title
        } catch (e) {
          if (signal.aborted) break
          a.status = 'error'
          a.error = (e as Error).message
        }
      }
      if (signal.aborted) {
        current.stage = 'cancelled'
        current.message = '已停止，已写好的文章保留在「我的文章」里'
        return
      }
      const ok = current.articles.filter((a) => a.status === 'done').length
      if (!ok) throw new Error(`全部生成失败：${current.articles[0]?.error ?? '未知原因'}`)
      current.stage = 'done'
      current.message = `写好了 ${ok} 篇${ok < current.articles.length ? `，${current.articles.length - ok} 篇失败` : ''}`
    } catch (e) {
      if (signal.aborted || (e as Error).name === 'AbortError') {
        current.stage = 'cancelled'
        current.message = '已停止'
      } else {
        current.stage = 'error'
        current.error = (e as Error).message
        current.message = (e as Error).message
      }
    }
  })()

  return current
}
