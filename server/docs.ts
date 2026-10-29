/**
 * 素材库批量生成文档：选中的素材逐条交给 AI，结果合成一份 Word 文档。
 * 生成是后台任务，前端轮询进度；同一时间只跑一个任务。
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildPrompt, chat, getConfig } from './ai.js'
import { buildDocx, type DocSection } from './docx.js'
import { DATA_DIR } from './paths.js'
import { listFavorites } from './store.js'

export const DOCS_DIR = path.join(DATA_DIR, 'docs')

export type DocTask = 'analyze' | 'draft'
const TASK_NAME: Record<DocTask, string> = { analyze: '选题分析', draft: '文案初稿' }
const PLATFORM_NAME: Record<string, string> = { wechat: '公众号', xiaohongshu: '小红书', video: '短视频口播', weibo: '微博' }

export interface DocJob {
  id: string
  task: DocTask
  platform: string
  total: number
  done: number
  current: string
  failed: number
  status: 'running' | 'done' | 'error' | 'cancelled'
  error?: string
  file?: string
  startedAt: number
}

let job: DocJob | null = null
let abort: AbortController | null = null

export const getJob = () => job

export function cancelJob() {
  if (job?.status === 'running') abort?.abort()
}

const MAX_ITEMS = 30

export async function startJob(input: { ids: unknown; task: unknown; platform: unknown; tones?: unknown; template?: unknown; customTemplate?: unknown }): Promise<DocJob> {
  if (job?.status === 'running') throw new Error('已有文档正在生成，请等它完成或先取消')
  if (!(await getConfig()).apiKey) throw new Error('还没有配置 API Key，请先在「AI 设置」里填写')
  const task: DocTask = input.task === 'draft' ? 'draft' : 'analyze'
  const platform = typeof input.platform === 'string' && input.platform in PLATFORM_NAME ? input.platform : 'wechat'
  const ids = Array.isArray(input.ids) ? input.ids.map(String) : []
  // 按素材库里的顺序（最新收藏在前）
  const favs = (await listFavorites()).filter((f) => ids.includes(f.id))
  if (!favs.length) throw new Error('请先选择要生成的素材')
  if (favs.length > MAX_ITEMS) throw new Error(`一次最多选择 ${MAX_ITEMS} 条素材`)

  abort = new AbortController()
  const signal = abort.signal
  const current: DocJob = {
    id: randomUUID(),
    task,
    platform,
    total: favs.length,
    done: 0,
    current: '',
    failed: 0,
    status: 'running',
    startedAt: Date.now(),
  }
  job = current

  ;(async () => {
    const sections: DocSection[] = []
    try {
      for (const f of favs) {
        if (signal.aborted) break
        current.current = f.title
        const section: DocSection = { title: f.title, url: f.url, source: f.source, tags: f.tags, note: f.note }
        try {
          const prompt = await buildPrompt({ task, platform, tones: input.tones, template: input.template, customTemplate: input.customTemplate, topic: { title: f.title, desc: f.desc, source: f.source, note: f.note } })
          // 每条最多 3 分钟；取消时也会中断
          section.content = await chat(prompt, AbortSignal.any([signal, AbortSignal.timeout(3 * 60_000)]))
          if (!section.content.trim()) throw new Error('AI 没有返回内容')
        } catch (e) {
          if (signal.aborted) break
          section.error = (e as Error).message
          current.failed++
        }
        sections.push(section)
        current.done++
      }
      if (signal.aborted) {
        current.status = 'cancelled'
        return
      }
      if (current.failed === current.total) throw new Error(`全部 ${current.total} 条都生成失败：${sections[0]?.error}`)

      const now = new Date()
      const label = task === 'draft' ? `${TASK_NAME.draft}（${PLATFORM_NAME[platform]}）` : TASK_NAME.analyze
      const buf = await buildDocx({
        title: `${label} · ${favs.length} 篇`,
        subtitle: `选题雷达生成于 ${now.toLocaleString('zh-CN')}。AI 生成内容仅供参考，发布前请核实事实。`,
        sections,
      })
      const stamp = now.toLocaleString('sv-SE').replace(/[: ]/g, '-').slice(0, 16) // 2026-10-29-14-05
      const file = `${stamp}-${label.replace(/[（）]/g, '')}-${favs.length}篇.docx`
      await mkdir(DOCS_DIR, { recursive: true })
      await writeFile(path.join(DOCS_DIR, file), buf)
      current.file = file
      current.status = 'done'
    } catch (e) {
      current.status = 'error'
      current.error = (e as Error).message
    } finally {
      current.current = ''
    }
  })()

  return current
}

export async function listDocs(): Promise<{ file: string; size: number; createdAt: number }[]> {
  const files = (await readdir(DOCS_DIR).catch(() => [] as string[])).filter((f) => f.endsWith('.docx'))
  const list = await Promise.all(
    files.map(async (file) => {
      const s = await stat(path.join(DOCS_DIR, file))
      return { file, size: s.size, createdAt: s.mtimeMs }
    }),
  )
  return list.sort((a, b) => b.createdAt - a.createdAt)
}

/** 只允许访问 docs 目录下的 .docx 文件，防止路径穿越 */
export function docPath(file: string): string | null {
  if (!file.endsWith('.docx') || file !== path.basename(file)) return null
  return path.join(DOCS_DIR, file)
}
