import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Response } from 'express'
import { getHot, hotSources } from './hot.js'
import { DATA_DIR } from './paths.js'

export interface AiConfig {
  baseUrl: string
  apiKey: string
  model: string
}

const file = path.join(DATA_DIR, 'ai-config.json')
let config: AiConfig | null = null

export async function getConfig(): Promise<AiConfig> {
  if (config) return config
  try {
    config = JSON.parse(await readFile(file, 'utf8')) as AiConfig
  } catch {
    config = { baseUrl: 'https://api.deepseek.com', apiKey: '', model: 'deepseek-v4-flash' }
  }
  return config
}

/** 返回给前端的配置不带完整 Key */
export async function publicConfig() {
  const c = await getConfig()
  return {
    baseUrl: c.baseUrl,
    model: c.model,
    hasKey: !!c.apiKey,
    keyHint: c.apiKey ? `${c.apiKey.slice(0, 3)}…${c.apiKey.slice(-4)}` : '',
  }
}

export async function saveConfig(input: Record<string, unknown>) {
  const c = await getConfig()
  const baseUrl = String(input.baseUrl ?? c.baseUrl).trim().replace(/\/+$/, '')
  if (!/^https?:\/\//.test(baseUrl)) throw new Error('接口地址必须以 http:// 或 https:// 开头')
  config = {
    baseUrl,
    model: String(input.model ?? c.model).trim(),
    // 留空表示不修改已保存的 Key
    apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey.trim() : c.apiKey,
  }
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(config, null, 2))
}

const PLATFORM_STYLE: Record<string, string> = {
  wechat: '微信公众号长文：有吸引人的标题和导语，小标题分段，1500-2500 字，观点清晰、有信息量，结尾引导关注或留言。',
  xiaohongshu:
    '小红书笔记：标题 20 字以内、带情绪或数字，正文口语化、分段短、适当使用 emoji，300-600 字，结尾附 5-8 个话题标签。',
  video:
    '短视频口播稿（抖音/视频号）：前 3 秒必须有钩子，口语化短句，时长约 60-90 秒（约 300-400 字），标注画面或字幕建议，结尾引导互动。',
  weibo: '微博：140-300 字，观点鲜明，带 1-2 个相关话题标签，适合引发讨论和转发。',
}

const SYSTEM = '你是一名资深的中文自媒体内容策划和编辑，熟悉各平台的流量规律和内容风格。回答使用 Markdown 格式，内容具体、可执行，不说空话。'

interface Topic {
  title: string
  desc?: string
  source?: string
  note?: string
}

function topicText(t: Topic) {
  return [
    `标题：${t.title}`,
    t.source && `来源：${t.source}`,
    t.desc && `摘要：${t.desc}`,
    t.note && `我的笔记：${t.note}`,
  ]
    .filter(Boolean)
    .join('\n')
}

export async function buildPrompt(body: Record<string, unknown>): Promise<string> {
  const task = body.task
  const topic = (body.topic ?? {}) as Topic
  if (task === 'analyze') {
    if (!topic.title) throw new Error('缺少选题')
    return `请对下面这个热点做自媒体选题分析：

${topicText(topic)}

请输出：
1. **事件梳理**：用 2-3 句话说明这件事是什么、为什么会火（如果信息不足，说明需要核实的地方，不要编造事实）。
2. **目标受众**：哪些人群会关心。
3. **切入角度**：给出 4 个不同的切入角度，每个说明适合的平台和预期效果。
4. **爆款标题**：给出 6 个不同风格的标题。
5. **内容大纲**：为最推荐的角度写一份大纲。
6. **风险提示**：涉及的敏感点、版权或事实核查注意事项。`
  }
  if (task === 'draft') {
    if (!topic.title) throw new Error('缺少选题')
    const style = PLATFORM_STYLE[String(body.platform)] ?? PLATFORM_STYLE.wechat
    return `请根据下面的选题写一篇初稿。

${topicText(topic)}

平台和风格要求：${style}

注意：不要编造具体数据、引语或未经证实的细节；需要作者补充或核实的地方用【待补充：…】标出。直接输出成稿，不要解释写作思路。`
  }
  if (task === 'summary') {
    const results = await Promise.all(hotSources.map((s) => getHot(s.id)))
    const lists = results
      .filter((r) => r.items.length)
      .map((r) => `【${r.name}】\n${r.items.slice(0, 15).map((i, n) => `${n + 1}. ${i.title}${i.hot ? `（${i.hot}）` : ''}`).join('\n')}`)
      .join('\n\n')
    if (!lists) throw new Error('热榜数据暂时获取不到')
    return `下面是今天各平台的实时热榜：

${lists}

请帮我做一份自媒体选题日报：
1. **今日热点主题**：把相同或相关的话题合并，归纳出 5-8 个主题，每个说明涉及哪些平台、热度如何。
2. **跨平台共振**：哪些话题在多个平台同时上榜，说明它们值得优先做。
3. **推荐选题**：挑出 5 个最适合自媒体创作的选题，每个给出一个切入角度和一个标题。
4. **不建议跟的热点**：哪些话题敏感、时效太短或同质化严重，简单说明原因。`
  }
  throw new Error('未知任务')
}

/** 网页里用：把 AI 输出边生成边写给前端 */
export async function streamChat(prompt: string, res: Response, signal: AbortSignal) {
  await chat(prompt, signal, (delta) => {
    if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
    res.write(delta)
  })
  if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end()
}

/** 调用 OpenAI 兼容的 /chat/completions 流式接口，返回完整文本；onDelta 收到每段增量 */
export async function chat(prompt: string, signal: AbortSignal, onDelta?: (s: string) => void): Promise<string> {
  const c = await getConfig()
  if (!c.apiKey) throw new Error('还没有配置 API Key，请先在「AI 设置」里填写')
  const upstream = await fetch(`${c.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
    body: JSON.stringify({
      model: c.model,
      stream: true,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
    }),
    signal,
  })
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    let msg = text.slice(0, 300)
    try {
      msg = JSON.parse(text).error?.message ?? msg
    } catch {}
    throw new Error(`AI 接口返回 ${upstream.status}：${msg}`)
  }

  const decoder = new TextDecoder()
  let buf = ''
  let full = ''
  for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const data = line.replace(/^data:\s*/, '').trim()
      if (!line.startsWith('data:') || !data || data === '[DONE]') continue
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) {
          full += delta
          onDelta?.(delta)
        }
      } catch {}
    }
  }
  return full
}
