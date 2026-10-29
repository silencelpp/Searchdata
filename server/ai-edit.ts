/**
 * 发布前的两个 AI 功能：
 * - 校对：找错别字、病句、事实存疑的地方，返回可以一键替换的修改建议
 * - 改写：把通用版本改成某个平台的专属版本（比如公众号长文 → 小红书笔记）
 */
import { chat, PLATFORM_STYLE } from './ai.js'
import { TITLE_LIMIT } from './checks.js'
import { PLATFORMS, type PlatformId } from './posts.js'
import { toneText } from './tones.js'

export interface Suggestion {
  /** 原文里要替换的那一小段，必须能在原文中找到 */
  find: string
  replace: string
  reason: string
  kind: 'typo' | 'grammar' | 'fact' | 'style'
}

/** 从 AI 回复里取出 JSON：可能被 ```json 包着，前后也可能有说明文字 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.search(/[[{]/)
  const end = Math.max(raw.lastIndexOf(']'), raw.lastIndexOf('}'))
  if (start < 0 || end < start) throw new Error('AI 返回的格式不对，请重试')
  return JSON.parse(raw.slice(start, end + 1)) as T
}

const KINDS = new Set(['typo', 'grammar', 'fact', 'style'])

export async function proofread(title: string, content: string, signal: AbortSignal): Promise<Suggestion[]> {
  const prompt = `请校对下面这篇准备发布的中文自媒体文章，找出：
- typo：错别字、用错的词、标点错误
- grammar：病句、语序不通、成分残缺
- fact：可能有事实错误、数据存疑、需要核实的说法（replace 写成更稳妥的表述）
- style：明显的重复啰嗦、AI 腔的套话

只输出一个 JSON 数组，不要其他文字。每一项格式：
{"find": "原文中要修改的那一小段（必须和原文一字不差，尽量短，5-30 字）", "replace": "修改后的文字", "reason": "为什么改，一句话", "kind": "typo|grammar|fact|style"}
没有问题就输出 []。最多 20 项，优先列出最重要的。不要改动 Markdown 标记。

标题：${title}

正文：
${content}`
  const text = await chat(prompt, signal)
  const list = extractJson<unknown[]>(text)
  if (!Array.isArray(list)) throw new Error('AI 返回的格式不对，请重试')
  const full = `${title}\n${content}`
  return (
    list
      .filter((x): x is Suggestion => !!x && typeof (x as any).find === 'string' && typeof (x as any).replace === 'string')
      .map((x) => ({
        find: x.find,
        replace: x.replace,
        reason: String(x.reason ?? ''),
        kind: KINDS.has(x.kind) ? x.kind : 'style',
      }))
      // 原文里找不到的建议没法替换，丢掉；改了等于没改的也丢掉
      .filter((x) => x.find && x.find !== x.replace && full.includes(x.find))
      .slice(0, 20)
  )
}

/** 按选定的文章类型/语气优化文章：内容和事实不变，只调整表达；结果不直接保存，交给用户确认 */
export async function restyle(
  post: { title: string; content: string },
  tones: unknown,
  signal: AbortSignal,
): Promise<{ title: string; content: string }> {
  const desc = toneText(tones)
  if (!desc) throw new Error('请至少选择一个文章类型')
  const prompt = `请把下面这篇文章按指定的类型和语气优化：${desc}。

要求：
- 保留原文的核心观点、事实、数据和结构，不要编造新内容
- 调整用词、句式、开头和结尾，让全文都符合这个语气；标题也可以相应优化
- 原文里的【待补充】标记要原样保留，Markdown 格式保留

只输出一个 JSON 对象，不要其他文字：
{"title": "优化后的标题", "content": "优化后的正文（Markdown）"}

原标题：${post.title}

原正文：
${post.content}`
  const j = extractJson<{ title?: unknown; content?: unknown }>(await chat(prompt, signal))
  const title = String(j.title ?? '').trim()
  const content = String(j.content ?? '').trim()
  if (!title || !content) throw new Error('AI 没有返回完整的标题和正文，请重试')
  return { title, content }
}

export async function rewriteFor(
  platform: PlatformId,
  post: { title: string; content: string; tags: string[] },
  signal: AbortSignal,
): Promise<{ title: string; content: string; tags: string[] }> {
  const prompt = `把下面这篇文章改写成适合「${PLATFORMS[platform]}」发布的版本。

平台要求：${PLATFORM_STYLE[platform]}
标题必须在 ${TITLE_LIMIT[platform]} 字以内。
保留原文的核心观点和事实，不要编造新的数据或引语；原文里的【待补充】标记要原样保留。

只输出一个 JSON 对象，不要其他文字：
{"title": "新标题", "content": "新正文（Markdown）", "tags": ["话题1", "话题2"]}
${platform === 'xiaohongshu' ? 'tags 放 5-8 个小红书话题，不带 # 号，正文里不要再重复写话题。' : 'tags 放 3-5 个标签，不带 # 号。'}

原标题：${post.title}
原标签：${post.tags.join('、') || '无'}

原正文：
${post.content}`
  const text = await chat(prompt, signal)
  const j = extractJson<{ title?: unknown; content?: unknown; tags?: unknown }>(text)
  const title = String(j.title ?? '').trim()
  const content = String(j.content ?? '').trim()
  if (!title || !content) throw new Error('AI 没有返回完整的标题和正文，请重试')
  const tags = Array.isArray(j.tags) ? j.tags.map((t) => String(t).replace(/^#/, '').trim()).filter(Boolean) : []
  return { title, content, tags }
}
