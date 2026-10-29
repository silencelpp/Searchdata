/** 把 AI 写的 Markdown 转成各平台需要的格式 */
import { marked, type Token, type Tokens } from 'marked'

/** 公众号会去掉 class 和 <style>，只能用行内样式 */
const WECHAT_STYLE: Record<string, string> = {
  h1: 'font-size:22px;font-weight:bold;margin:28px 0 14px;color:#1f2329;line-height:1.4',
  h2: 'font-size:18px;font-weight:bold;margin:28px 0 14px;padding-left:10px;border-left:4px solid #ff5a36;color:#1f2329;line-height:1.4',
  h3: 'font-size:16px;font-weight:bold;margin:22px 0 10px;color:#1f2329',
  h4: 'font-size:15px;font-weight:bold;margin:18px 0 8px;color:#1f2329',
  p: 'font-size:15px;line-height:1.8;margin:0 0 16px;color:#333;letter-spacing:0.5px',
  blockquote: 'margin:16px 0;padding:10px 14px;border-left:3px solid #dcdfe4;background:#f7f8fa;color:#666',
  ul: 'margin:0 0 16px;padding-left:22px',
  ol: 'margin:0 0 16px;padding-left:22px',
  li: 'font-size:15px;line-height:1.8;margin:4px 0;color:#333',
  strong: 'font-weight:bold;color:#1f2329',
  a: 'color:#576b95;text-decoration:none',
  table: 'border-collapse:collapse;width:100%;margin:16px 0;font-size:14px',
  th: 'border:1px solid #dcdfe4;padding:6px 10px;background:#f7f8fa;font-weight:bold',
  td: 'border:1px solid #dcdfe4;padding:6px 10px',
  code: 'background:#f3f4f5;padding:2px 4px;border-radius:3px;font-size:14px',
  pre: 'background:#f6f8fa;padding:12px;border-radius:6px;overflow-x:auto;font-size:13px;line-height:1.6',
  hr: 'border:0;border-top:1px solid #eceef1;margin:24px 0',
}

export const toHtml = (md: string) => marked.parse(md, { async: false })

export function toWechatHtml(md: string) {
  return toHtml(md).replace(/<(h[1-4]|p|blockquote|ul|ol|li|strong|a|table|th|td|code|pre|hr)(\s[^>]*)?(\/?)>/g, (_m, tag, attrs = '', slash) => {
    return `<${tag}${attrs} style="${WECHAT_STYLE[tag]}"${slash}>`
  })
}

const decode = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')

function inlineText(tokens?: Token[]): string {
  return (tokens ?? [])
    .map((t) => {
      if (t.type === 'br') return '\n'
      // 纯文本里放不了图片，也不留图片的说明文字
      if (t.type === 'image') return ''
      if ('tokens' in t && t.tokens?.length) return inlineText(t.tokens)
      return 'text' in t ? decode(String(t.text)) : ''
    })
    .join('')
}

function blocksText(tokens: Token[], depth = 0): string[] {
  const out: string[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading':
      case 'paragraph':
        out.push(inlineText((t as Tokens.Heading).tokens))
        break
      case 'list': {
        const list = t as Tokens.List
        const lines = list.items.map((item, i) => {
          const [first, ...rest] = item.tokens
          const head = first && (first.type === 'text' || first.type === 'paragraph') ? inlineText((first as Tokens.Text).tokens ?? [first]) : ''
          const sub = blocksText(head ? rest : item.tokens, depth + 1)
          const marker = list.ordered ? `${Number(list.start || 1) + i}. ` : '• '
          return ['  '.repeat(depth) + marker + head, ...sub].join('\n')
        })
        out.push(lines.join('\n'))
        break
      }
      case 'blockquote':
        out.push(...blocksText((t as Tokens.Blockquote).tokens, depth))
        break
      case 'code':
        out.push((t as Tokens.Code).text)
        break
      case 'table': {
        const tb = t as Tokens.Table
        out.push([tb.header, ...tb.rows].map((r) => r.map((c) => inlineText(c.tokens)).join(' | ')).join('\n'))
        break
      }
      default:
        if ('text' in t && typeof t.text === 'string' && t.type !== 'space' && t.type !== 'hr') out.push(decode(t.text))
    }
  }
  return out.filter((s) => s.trim())
}

/** 纯文本：去掉 Markdown 标记，段落之间空一行（小红书正文用） */
export function toPlain(md: string) {
  return blocksText(marked.lexer(md)).join('\n\n')
}

/** 从 AI 初稿里拆出标题：第一个 Markdown 标题，或者第一行 */
export function splitDraft(md: string, fallbackTitle: string) {
  const lines = md.trim().split('\n')
  const i = lines.findIndex((l) => /^#{1,3}\s+\S/.test(l))
  if (i >= 0 && i < 3) {
    return { title: lines[i].replace(/^#+\s+/, '').trim(), content: lines.slice(i + 1).join('\n').trim() }
  }
  return { title: fallbackTitle, content: md.trim() }
}
