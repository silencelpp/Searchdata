import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './paths.js'

export interface Favorite {
  id: string
  title: string
  url: string
  source: string
  desc?: string
  note: string
  tags: string[]
  createdAt: number
}

const file = path.join(DATA_DIR, 'favorites.json')

// 网页后端和 MCP 服务是两个进程，都会改这个文件，所以每次操作都从磁盘重新读，
// 不在内存里缓存；写入先写临时文件再改名，避免读到写了一半的文件
async function load(): Promise<Favorite[]> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Favorite[]
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw e
  }
}

async function save(items: Favorite[]) {
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(items, null, 2))
  await rename(tmp, file)
}

// 同一进程内的读-改-写排队执行
let queue: Promise<unknown> = Promise.resolve()
function mutate<T>(fn: (items: Favorite[]) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const items = await load()
    const result = await fn(items)
    await save(items)
    return result
  })
  queue = run.catch(() => {})
  return run
}

const toTags = (v: unknown) =>
  Array.isArray(v) ? [...new Set(v.map((t) => String(t).trim()).filter(Boolean))] : []

export const listFavorites = load

export function addFavorite(input: Record<string, unknown>): Promise<Favorite> {
  return mutate((items) => {
    const existing = items.find((f) => f.url === input.url)
    if (existing) return existing
    const fav: Favorite = {
      id: randomUUID(),
      title: String(input.title ?? '').slice(0, 500),
      url: String(input.url),
      source: String(input.source ?? ''),
      desc: input.desc ? String(input.desc).slice(0, 2000) : undefined,
      note: String(input.note ?? ''),
      tags: toTags(input.tags),
      createdAt: Date.now(),
    }
    items.unshift(fav)
    return fav
  })
}

export function updateFavorite(id: string, patch: Record<string, unknown>) {
  return mutate((items) => {
    const fav = items.find((f) => f.id === id)
    if (!fav) return null
    if (typeof patch.note === 'string') fav.note = patch.note
    if (Array.isArray(patch.tags)) fav.tags = toTags(patch.tags)
    return fav
  })
}

export function removeFavorite(id: string): Promise<boolean> {
  return mutate((items) => {
    const i = items.findIndex((f) => f.id === id)
    if (i >= 0) items.splice(i, 1)
    return i >= 0
  })
}
