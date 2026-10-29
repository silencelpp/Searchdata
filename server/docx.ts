/** 把 AI 生成的 Markdown 转成 Word 文档 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from 'docx'
import { marked, type Token, type Tokens } from 'marked'

const FONT = { ascii: 'Calibri', hAnsi: 'Calibri', eastAsia: '微软雅黑' }
const ACCENT = 'FF5A36'
const MUTED = '8A919C'
// A4 宽 11906，左右边距各 1134（2 厘米）
const CONTENT_WIDTH = 11906 - 1134 * 2

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4]

interface InlineStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  code?: boolean
}

/** 行内元素：加粗、斜体、链接、行内代码等 */
function inline(tokens: Token[] | undefined, style: InlineStyle = {}): ParagraphChild[] {
  const out: ParagraphChild[] = []
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...inline((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...inline((t as Tokens.Em).tokens, { ...style, italics: true }))
        break
      case 'del':
        out.push(...inline((t as Tokens.Del).tokens, { ...style, strike: true }))
        break
      case 'codespan':
        out.push(run((t as Tokens.Codespan).text, { ...style, code: true }))
        break
      case 'br':
        out.push(new TextRun({ break: 1 }))
        break
      case 'link': {
        const link = t as Tokens.Link
        if (/^https?:\/\//.test(link.href)) {
          out.push(
            new ExternalHyperlink({
              link: link.href,
              children: [run(textOf(link.tokens) || link.href, { ...style }, { color: '3370FF', underline: {} })],
            }),
          )
        } else {
          out.push(...inline(link.tokens, style))
        }
        break
      }
      case 'text': {
        const text = t as Tokens.Text
        if (text.tokens?.length) out.push(...inline(text.tokens, style))
        else out.push(run(decode(text.text), style))
        break
      }
      case 'escape':
        out.push(run((t as Tokens.Escape).text, style))
        break
      default:
        if ('text' in t && typeof t.text === 'string') out.push(run(decode(t.text), style))
    }
  }
  return out
}

function run(text: string, style: InlineStyle, extra: Record<string, unknown> = {}) {
  return new TextRun({
    text,
    bold: style.bold,
    italics: style.italics,
    strike: style.strike,
    font: style.code ? { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '微软雅黑' } : undefined,
    shading: style.code ? { type: ShadingType.CLEAR, fill: 'F2F3F5', color: 'auto' } : undefined,
    ...extra,
  })
}

function textOf(tokens?: Token[]): string {
  return (tokens ?? []).map((t) => ('tokens' in t && t.tokens ? textOf(t.tokens) : 'text' in t ? String(t.text) : '')).join('')
}

/** marked 会把 & < > 等转成实体，这里还原 */
function decode(s: string) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/**
 * 块级元素。headingOffset 用来整体降级标题：
 * 文档里每篇素材的标题已经是一级标题，AI 内容里的 # 要从二级开始
 */
function blocks(tokens: Token[], headingOffset: number, listLevel = 0): (Paragraph | Table)[] {
  const out: (Paragraph | Table)[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push(new Paragraph({ heading: HEADINGS[Math.min(h.depth - 1 + headingOffset, 3)], children: inline(h.tokens) }))
        break
      }
      case 'paragraph':
        out.push(new Paragraph({ children: inline((t as Tokens.Paragraph).tokens) }))
        break
      case 'list': {
        const list = t as Tokens.List
        for (const item of list.items) {
          // 列表项第一段放在带编号的段落里，其余内容（嵌套列表等）跟在后面
          const [first, ...rest] = item.tokens
          const firstInline = first && (first.type === 'text' || first.type === 'paragraph') ? inline((first as Tokens.Text).tokens ?? [first]) : []
          out.push(
            new Paragraph({
              spacing: { after: 40 },
              numbering: list.ordered
                ? { reference: 'numbers', level: Math.min(listLevel, 2), instance: orderedInstance(list) }
                : { reference: 'bullets', level: Math.min(listLevel, 2) },
              children: firstInline,
            }),
          )
          const restTokens = firstInline.length ? rest : item.tokens
          out.push(...blocks(restTokens, headingOffset, listLevel + 1))
        }
        break
      }
      case 'blockquote':
        // 引用块：段落左侧加一道橙色竖线；引用里的列表等其他内容按普通方式输出
        for (const c of (t as Tokens.Blockquote).tokens) {
          if (c.type === 'paragraph' || c.type === 'text') {
            out.push(
              new Paragraph({
                indent: { left: 240 },
                border: { left: { style: BorderStyle.SINGLE, size: 18, color: ACCENT, space: 8 } },
                children: inline((c as Tokens.Paragraph).tokens),
              }),
            )
          } else {
            out.push(...blocks([c], headingOffset, listLevel))
          }
        }
        break
      case 'code':
        for (const line of (t as Tokens.Code).text.split('\n')) {
          out.push(
            new Paragraph({
              shading: { type: ShadingType.CLEAR, fill: 'F5F6F8', color: 'auto' },
              spacing: { after: 0 },
              children: [new TextRun({ text: line || ' ', font: { ascii: 'Consolas', hAnsi: 'Consolas', eastAsia: '微软雅黑' }, size: 20 })],
            }),
          )
        }
        break
      case 'hr':
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'DDDDDD', space: 1 } } }))
        break
      case 'table':
        out.push(table(t as Tokens.Table))
        break
      case 'space':
        break
      default:
        if ('text' in t && typeof t.text === 'string' && t.text.trim()) out.push(new Paragraph({ text: decode(t.text) }))
    }
  }
  return out
}

// 每个有序列表用独立的编号实例，不然编号会接着上一个列表往下数。实例 0 留给目录
let instanceSeq = 0
const instanceOf = new WeakMap<Tokens.List, number>()
function orderedInstance(list: Tokens.List) {
  if (!instanceOf.has(list)) instanceOf.set(list, ++instanceSeq)
  return instanceOf.get(list)!
}

function table(t: Tokens.Table) {
  const cols = t.header.length
  const w = Math.floor(CONTENT_WIDTH / cols)
  const widths = Array.from({ length: cols }, (_, i) => (i === cols - 1 ? CONTENT_WIDTH - w * (cols - 1) : w))
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'DDDDDD' }
  const borders = { top: border, bottom: border, left: border, right: border }
  const cell = (c: Tokens.TableCell, i: number, header: boolean) =>
    new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      borders,
      shading: header ? { type: ShadingType.CLEAR, fill: 'F5F6F8', color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ spacing: { after: 0 }, children: inline(c.tokens, { bold: header }) })],
    })
  return new Table({
    width: { size: CONTENT_WIDTH, type: WidthType.DXA },
    columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: t.header.map((c, i) => cell(c, i, true)) }),
      ...t.rows.map((r) => new TableRow({ children: r.map((c, i) => cell(c, i, false)) })),
    ],
  })
}

export function markdownToBlocks(md: string, headingOffset = 1) {
  return blocks(marked.lexer(md), headingOffset)
}

// ---------- 文档结构 ----------

export interface DocSection {
  title: string
  url: string
  source?: string
  tags?: string[]
  note?: string
  /** AI 生成的 Markdown；生成失败时为空，error 里是原因 */
  content?: string
  error?: string
}

export async function buildDocx(opts: { title: string; subtitle: string; sections: DocSection[] }): Promise<Buffer> {
  instanceSeq = 0
  const meta = (label: string, children: ParagraphChild[]) =>
    new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text: `${label}：`, color: MUTED, size: 20 }), ...children],
    })

  const body: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(opts.title)] }),
    new Paragraph({ children: [new TextRun({ text: opts.subtitle, color: MUTED })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('目录')] }),
    ...opts.sections.map(
      (s) => new Paragraph({ numbering: { reference: 'numbers', level: 0, instance: 0 }, children: [new TextRun(s.title)] }),
    ),
  ]

  for (const s of opts.sections) {
    body.push(new Paragraph({ children: [new PageBreak()] }))
    body.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(s.title)] }))
    if (s.source) body.push(meta('来源', [new TextRun({ text: s.source, size: 20 })]))
    body.push(
      meta('链接', [
        new ExternalHyperlink({ link: s.url, children: [new TextRun({ text: s.url, color: '3370FF', underline: {}, size: 20 })] }),
      ]),
    )
    if (s.tags?.length) body.push(meta('标签', [new TextRun({ text: s.tags.map((t) => `#${t}`).join('  '), size: 20 })]))
    if (s.note) body.push(meta('我的笔记', [new TextRun({ text: s.note, size: 20 })]))
    body.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'EEEEEE', space: 4 } }, spacing: { after: 200 } }))
    if (s.content) body.push(...markdownToBlocks(s.content, 1))
    else body.push(new Paragraph({ children: [new TextRun({ text: `这一篇生成失败：${s.error ?? '未知原因'}`, color: 'D4380D' })] }))
  }

  const doc = new Document({
    creator: '选题雷达',
    title: opts.title,
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { line: 360, after: 120 } } },
      },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', run: { size: 44, bold: true, font: FONT }, paragraph: { spacing: { after: 120 } } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 34, bold: true, font: FONT }, paragraph: { spacing: { before: 120, after: 160 }, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 28, bold: true, font: FONT, color: '1F2329' }, paragraph: { spacing: { before: 280, after: 120 }, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 24, bold: true, font: FONT }, paragraph: { spacing: { before: 200, after: 80 }, outlineLevel: 2 } },
        { id: 'Heading4', name: 'Heading 4', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 22, bold: true, font: FONT }, paragraph: { spacing: { before: 160, after: 60 }, outlineLevel: 3 } },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullets',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: LevelFormat.BULLET,
            text: ['●', '○', '■'][level],
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420 * (level + 1), hanging: 280 } } },
          })),
        },
        {
          reference: 'numbers',
          levels: [0, 1, 2].map((level) => ({
            level,
            format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level],
            text: `%${level + 1}.`,
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420 * (level + 1), hanging: 320 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1247, bottom: 1247, left: 1134, right: 1134 } } },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ children: [PageNumber.CURRENT], color: MUTED, size: 18 })],
              }),
            ],
          }),
        },
        children: body,
      },
    ],
  })
  return Packer.toBuffer(doc)
}
