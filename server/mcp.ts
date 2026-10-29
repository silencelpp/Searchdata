/**
 * MCP 服务（stdio）：把热榜、搜索、素材库提供给 Claude、Cursor、VS Code、Codex 等 AI 工具调用。
 * 注意：stdio 模式下 stdout 用来传协议消息，这里不能用 console.log，日志要用 console.error。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { getHot, hotSources } from './hot.js'
import { search, searchSources } from './search.js'
import { addFavorite, listFavorites, removeFavorite, updateFavorite, type Favorite } from './store.js'
import type { Item, SourceResult } from './types.js'

const server = new McpServer({ name: 'searchdata', version: '1.0.0' })

const hotIds = hotSources.map((s) => s.id) as [string, ...string[]]
const searchIds = searchSources.map((s) => s.id) as [string, ...string[]]

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const fail = (s: string) => ({ ...text(s), isError: true })

function itemLine(i: Item, n: number) {
  const meta = [i.hot, i.author, i.time].filter(Boolean).join(' · ')
  return [
    `${n + 1}. ${i.title}${meta ? `（${meta}）` : ''}`,
    `   链接：${i.url}`,
    i.desc && `   摘要：${i.desc.replace(/\s+/g, ' ').slice(0, 200)}`,
  ]
    .filter(Boolean)
    .join('\n')
}

function resultBlock(r: SourceResult, limit: number) {
  if (r.error) return `## ${r.name}\n获取失败：${r.error}`
  if (!r.items.length) return `## ${r.name}\n没有结果`
  return `## ${r.name}\n${r.items.slice(0, limit).map(itemLine).join('\n')}`
}

function favLine(f: Favorite) {
  return [
    `- [${f.id}] ${f.title}`,
    `  来源：${f.source || '未知'} · 收藏于 ${new Date(f.createdAt).toLocaleString('zh-CN')}`,
    `  链接：${f.url}`,
    f.tags.length && `  标签：${f.tags.map((t) => `#${t}`).join(' ')}`,
    f.note && `  笔记：${f.note.replace(/\n/g, ' ')}`,
  ]
    .filter(Boolean)
    .join('\n')
}

server.registerTool(
  'get_hot_list',
  {
    title: '获取全网热榜',
    description: `获取中文互联网各平台的实时热榜，用于寻找自媒体选题。可用来源：${hotSources
      .map((s) => `${s.id}（${s.name}）`)
      .join('、')}。source 填 all 表示获取全部平台。`,
    inputSchema: {
      source: z.enum(['all', ...hotIds]).default('all').describe('热榜来源，all 表示全部'),
      limit: z.number().int().min(1).max(50).default(20).describe('每个平台返回的条数'),
    },
  },
  async ({ source, limit }) => {
    const ids = source === 'all' ? hotIds : [source]
    const results = await Promise.all(ids.map((id) => getHot(id)))
    return text(results.map((r) => resultBlock(r, limit)).join('\n\n'))
  },
)

server.registerTool(
  'search',
  {
    title: '关键词搜索',
    description: `按关键词搜索相关内容。可用来源：${searchSources
      .map((s) => `${s.id}（${s.name}）`)
      .join('、')}。source 填 all 表示同时搜索全部来源。`,
    inputSchema: {
      query: z.string().min(1).max(100).describe('搜索关键词'),
      source: z.enum(['all', ...searchIds]).default('all').describe('搜索来源，all 表示全部'),
      page: z.number().int().min(1).max(50).default(1).describe('页码'),
    },
  },
  async ({ query, source, page }) => {
    const ids = source === 'all' ? searchIds : [source]
    const results = await Promise.all(ids.map((id) => search(id, query.trim(), page)))
    return text(results.map((r) => resultBlock(r, 20)).join('\n\n'))
  },
)

server.registerTool(
  'list_favorites',
  {
    title: '查看素材库',
    description: '列出素材库里收藏的选题，可以按标签或关键词筛选。返回内容中方括号里的是素材 id。',
    inputSchema: {
      tag: z.string().optional().describe('只看带这个标签的素材'),
      keyword: z.string().optional().describe('在标题、摘要、笔记中搜索'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ tag, keyword }) => {
    const list = (await listFavorites()).filter(
      (f) =>
        (!tag || f.tags.includes(tag)) &&
        (!keyword || [f.title, f.desc ?? '', f.note].some((s) => s.includes(keyword))),
    )
    if (!list.length) return text('素材库中没有匹配的素材')
    return text(`共 ${list.length} 条素材：\n${list.map(favLine).join('\n')}`)
  },
)

server.registerTool(
  'add_favorite',
  {
    title: '收藏到素材库',
    description: '把一个选题（通常来自热榜或搜索结果）存进素材库。同一链接只会保存一次。',
    inputSchema: {
      title: z.string().min(1).describe('标题'),
      url: z.string().url().regex(/^https?:\/\//).describe('原文链接'),
      source: z.string().optional().describe('来源平台，例如 微博热搜'),
      desc: z.string().optional().describe('摘要'),
      note: z.string().optional().describe('选题笔记、切入角度等'),
      tags: z.array(z.string()).optional().describe('标签，例如 ["科技", "待写"]'),
    },
  },
  async (input) => {
    const fav = await addFavorite(input)
    return text(`已收藏：\n${favLine(fav)}`)
  },
)

server.registerTool(
  'update_favorite',
  {
    title: '修改素材笔记或标签',
    description: '修改素材库里某条素材的笔记或标签。id 可以通过 list_favorites 获得。标签会整体替换。',
    inputSchema: {
      id: z.string().describe('素材 id'),
      note: z.string().optional().describe('新的笔记内容，会覆盖原笔记'),
      tags: z.array(z.string()).optional().describe('新的标签列表，会覆盖原标签'),
    },
    annotations: { idempotentHint: true },
  },
  async ({ id, ...patch }) => {
    const fav = await updateFavorite(id, patch)
    return fav ? text(`已更新：\n${favLine(fav)}`) : fail(`没有找到 id 为 ${id} 的素材`)
  },
)

server.registerTool(
  'remove_favorite',
  {
    title: '删除素材',
    description: '从素材库删除一条素材。id 可以通过 list_favorites 获得。',
    inputSchema: { id: z.string().describe('素材 id') },
    annotations: { destructiveHint: true },
  },
  async ({ id }) => ((await removeFavorite(id)) ? text('已删除') : fail(`没有找到 id 为 ${id} 的素材`)),
)

await server.connect(new StdioServerTransport())
console.error('searchdata MCP 服务已启动')
