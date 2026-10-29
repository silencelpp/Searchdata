/**
 * 待发布队列：文章先进队列，你审核、编辑后再选平台发布。
 * 公众号走官方接口推到草稿箱；小红书、头条、知乎用浏览器自动填写，填好后停住，由你检查后亲手点发布。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './paths.js'

export const PLATFORMS = {
  wechat: '微信公众号',
  xiaohongshu: '小红书',
  toutiao: '今日头条',
  zhihu: '知乎',
} as const
export type PlatformId = keyof typeof PLATFORMS
export const isPlatform = (v: unknown): v is PlatformId => typeof v === 'string' && v in PLATFORMS

export interface PublishResult {
  status: 'running' | 'filled' | 'drafted' | 'error'
  message: string
  at: number
}

export interface Post {
  id: string
  title: string
  /** Markdown 正文 */
  content: string
  summary: string
  /** 小红书话题、头条/知乎标签 */
  tags: string[]
  /** data/uploads 下的文件名 */
  cover?: string
  status: 'pending' | 'approved'
  platforms: PlatformId[]
  source?: { title: string; url: string }
  results: Partial<Record<PlatformId, PublishResult>>
  createdAt: number
  updatedAt: number
}

const file = path.join(DATA_DIR, 'posts.json')
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads')

async function load(): Promise<Post[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Post[]
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

async function save(items: Post[]) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(items, null, 2))
  await rename(tmp, file)
}

let queue: Promise<unknown> = Promise.resolve()
function mutate<T>(fn: (items: Post[]) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const items = await load()
    const result = await fn(items)
    await save(items)
    return result
  })
  queue = run.catch(() => {})
  return run
}

const str = (v: unknown, max: number) => String(v ?? '').slice(0, max)
const toTags = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))].slice(0, 20) : []

export const listPosts = load
export const getPost = async (id: string) => (await load()).find((p) => p.id === id) ?? null

export function createPost(input: Record<string, unknown>): Promise<Post> {
  return mutate((items) => {
    const now = Date.now()
    const src = input.source as { title?: unknown; url?: unknown } | undefined
    const post: Post = {
      id: randomUUID(),
      title: str(input.title, 200) || '未命名',
      content: str(input.content, 100_000),
      summary: str(input.summary, 300),
      tags: toTags(input.tags),
      status: 'pending',
      platforms: Array.isArray(input.platforms) ? input.platforms.filter(isPlatform) : [],
      source: src?.url ? { title: str(src.title, 500), url: str(src.url, 2000) } : undefined,
      results: {},
      createdAt: now,
      updatedAt: now,
    }
    items.unshift(post)
    return post
  })
}

export function updatePost(id: string, patch: Record<string, unknown>): Promise<Post | null> {
  return mutate((items) => {
    const p = items.find((x) => x.id === id)
    if (!p) return null
    if ('title' in patch) p.title = str(patch.title, 200) || '未命名'
    if ('content' in patch) p.content = str(patch.content, 100_000)
    if ('summary' in patch) p.summary = str(patch.summary, 300)
    if ('tags' in patch) p.tags = toTags(patch.tags)
    if ('platforms' in patch && Array.isArray(patch.platforms)) p.platforms = patch.platforms.filter(isPlatform)
    if ('cover' in patch) p.cover = typeof patch.cover === 'string' && patch.cover ? path.basename(patch.cover) : undefined
    // 改了内容就要重新审核
    if (['title', 'content', 'summary', 'tags', 'cover'].some((k) => k in patch)) p.status = 'pending'
    if (patch.status === 'approved' || patch.status === 'pending') p.status = patch.status
    p.updatedAt = Date.now()
    return p
  })
}

export function setResult(id: string, platform: PlatformId, result: Omit<PublishResult, 'at'>) {
  return mutate((items) => {
    const p = items.find((x) => x.id === id)
    if (p) p.results[platform] = { ...result, at: Date.now() }
  })
}

export async function removePost(id: string): Promise<boolean> {
  const removed = await mutate((items) => {
    const i = items.findIndex((x) => x.id === id)
    return i >= 0 ? items.splice(i, 1)[0] : null
  })
  if (removed?.cover) await unlink(path.join(UPLOAD_DIR, removed.cover)).catch(() => {})
  return !!removed
}

// ---------- 封面图 ----------

const IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }
const MAX_IMAGE = 10 * 1024 * 1024

/** 前端传 data URL，存成文件，返回文件名 */
export async function saveUpload(dataUrl: string): Promise<string> {
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)
  if (!m || !IMAGE_TYPES[m[1]]) throw new Error('只支持 PNG、JPG、WebP、GIF 图片')
  const buf = Buffer.from(m[2], 'base64')
  if (buf.length > MAX_IMAGE) throw new Error('图片不能超过 10 MB')
  await mkdir(UPLOAD_DIR, { recursive: true })
  const name = `${randomUUID()}.${IMAGE_TYPES[m[1]]}`
  await writeFile(path.join(UPLOAD_DIR, name), buf)
  return name
}

export function uploadPath(name: string): string | null {
  if (name !== path.basename(name) || !/^[0-9a-f-]{36}\.(png|jpg|webp|gif)$/.test(name)) return null
  return path.join(UPLOAD_DIR, name)
}
