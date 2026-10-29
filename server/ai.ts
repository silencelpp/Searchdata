import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Response } from 'express'
import { getHot, hotSources } from './hot.js'
import { DATA_DIR } from './paths.js'
import { toneText } from './tones.js'
import { ANTI_AI, templateText } from './writing.js'

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

export const PLATFORM_STYLE: Record<string, string> = {
  wechat: '微信公众号长文：有吸引人的标题和导语，小标题分段，1500-2500 字，观点清晰、有信息量，结尾引导关注或留言。',
  xiaohongshu:
    '小红书笔记：标题 20 字以内、带情绪或数字，正文口语化、分段短、适当使用 emoji，300-600 字，结尾附 5-8 个话题标签。',
  video:
    '短视频口播稿（抖音/视频号）：前 3 秒必须有钩子，口语化短句，时长约 60-90 秒（约 300-400 字），标注画面或字幕建议，结尾引导互动。',
  weibo: '微博：140-300 字，观点鲜明，带 1-2 个相关话题标签，适合引发讨论和转发。',
  toutiao: '今日头条文章：标题 30 字以内、信息量大、有悬念或数字，正文开门见山、段落短，1000-2000 字，适合大众读者，结尾引导评论。',
  zhihu: '知乎专栏文章：理性、有论据，先给结论再展开，多用事实、数据和亲身经验，1500-3000 字，避免营销腔和夸张标题。',
}

const SYSTEM =
  '你是一个做了很多年自媒体的老编辑，说话直接、接地气，像在跟同事聊天。你熟悉各平台的读者和流量规律，但不会用行业黑话。用 Markdown 输出，但只在必要时用小标题和列表。'

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
    return `我想写这个热点，你帮我看看值不值得写、怎么写：

${topicText(topic)}

像跟同事聊天一样回答，别写成报告。不要表格、不要分级标签、不要每段加粗。按这个顺序说就行：

先用两三句大白话讲清楚这事到底怎么回事、为什么会火。信息不够就直说哪里需要核实，别编。

然后说说哪些人会关心，以及你觉得最好写的一个角度，讲清楚为什么选它。另外再顺带提两个备选角度，一句话一个。

给我 5 个标题，要像真人起的，别用「震惊」「揭秘」这种词，也别都是一个套路。

最后用几句话列一下推荐角度的写法思路，再提醒一下有没有要避开的雷区。

${ANTI_AI}`
  }
  if (task === 'draft') {
    if (!topic.title) throw new Error('缺少选题')
    const style = PLATFORM_STYLE[String(body.platform)] ?? PLATFORM_STYLE.wechat
    const tones = toneText(body.tones)
    const structure = templateText(body.template, body.customTemplate)
    return `请根据下面的选题写一篇可以直接发的文章。

${topicText(topic)}

平台：${style}
${tones ? `语气：${tones}。全文都要是这个感觉，标题也是。\n` : ''}${structure ? `${structure}\n` : ''}
${ANTI_AI}

其他要求：
- 第一行用「# 标题」写标题，下面直接是正文。
- 不要编造具体数据、引语或细节；需要作者补充或核实的地方用【待补充：…】标出。
- 直接输出文章，不要解释写作思路，不要在结尾问「需要我修改吗」。`
  }
  if (task === 'summary') {
    const results = await Promise.all(hotSources.map((s) => getHot(s.id)))
    const lists = results
      .filter((r) => r.items.length)
      .map((r) => `【${r.name}】\n${r.items.slice(0, 15).map((i, n) => `${n + 1}. ${i.title}${i.hot ? `（${i.hot}）` : ''}`).join('\n')}`)
      .join('\n\n')
    if (!lists) throw new Error('热榜数据暂时获取不到')
    return `下面是今天各平台的热榜：

${lists}

你是我的选题编辑，早上帮我过一遍热榜，告诉我今天写什么。像在工作群里发消息一样说，口语化，别写成报告。

不要表格，不要「P0/P1」这种分级，不要「一、二、三」这种大标题，不要每句都加粗。

大概这样说：
先用一段话讲讲今天整体是什么情况，哪件事最火、在哪几个平台都上了榜。

然后挑 3-5 个今天最值得写的，每个用一个小标题（就写选题本身），下面说两三句：为什么值得写、从什么角度切、给一个能直接用的标题。

最后用一两句提醒一下今天哪些热点别碰，为什么。

${ANTI_AI}`
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
