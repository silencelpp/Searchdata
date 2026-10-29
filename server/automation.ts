/**
 * 自动化：热榜快照、飙升标记、关键词监控、每日选题日报。
 * 只在网页后端运行时执行（每分钟检查一次是否到点）。
 */
import { randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildPrompt, chat, getConfig as getAiConfig } from './ai.js'
import { getHot, hotSources } from './hot.js'
import { DATA_DIR } from './paths.js'
import { addFavorite } from './store.js'
import type { Item, SourceResult } from './types.js'

// ---------- 配置 ----------

export interface AutomationConfig {
  snapshot: { intervalMin: number }
  monitor: { enabled: boolean; keywords: string[]; autoSave: boolean }
  daily: { enabled: boolean; time: string }
}

const configFile = path.join(DATA_DIR, 'automation.json')
const DEFAULT_CONFIG: AutomationConfig = {
  snapshot: { intervalMin: 15 },
  monitor: { enabled: true, keywords: [], autoSave: false },
  daily: { enabled: false, time: '08:30' },
}
let config: AutomationConfig | null = null

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return fallback
    throw e
  }
}

async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(value, null, 2))
  await rename(tmp, file)
}

export async function getAutomationConfig(): Promise<AutomationConfig> {
  if (!config) {
    const saved = await readJson<Partial<AutomationConfig>>(configFile, {})
    config = {
      snapshot: { ...DEFAULT_CONFIG.snapshot, ...saved.snapshot },
      monitor: { ...DEFAULT_CONFIG.monitor, ...saved.monitor },
      daily: { ...DEFAULT_CONFIG.daily, ...saved.daily },
    }
  }
  return config
}

export async function saveAutomationConfig(input: Record<string, any>): Promise<AutomationConfig> {
  const c = await getAutomationConfig()
  const interval = Number(input.snapshot?.intervalMin ?? c.snapshot.intervalMin)
  if (![5, 10, 15, 30, 60].includes(interval)) throw new Error('快照间隔只能是 5、10、15、30、60 分钟')
  const time = String(input.daily?.time ?? c.daily.time)
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('日报时间格式应为 HH:MM')
  const keywords = Array.isArray(input.monitor?.keywords)
    ? [...new Set((input.monitor.keywords as unknown[]).map((k) => String(k).trim()).filter(Boolean))].slice(0, 50)
    : c.monitor.keywords
  config = {
    snapshot: { intervalMin: interval },
    monitor: {
      enabled: Boolean(input.monitor?.enabled ?? c.monitor.enabled),
      keywords,
      autoSave: Boolean(input.monitor?.autoSave ?? c.monitor.autoSave),
    },
    daily: { enabled: Boolean(input.daily?.enabled ?? c.daily.enabled), time },
  }
  await writeJson(configFile, config)
  return config
}

// ---------- 热榜快照 ----------

/** 每行一条快照：[标题, 排名(从1开始), 热度数值] */
type Row = [string, number, number | null]
interface Snapshot {
  at: number
  source: string
  rows: Row[]
}

const snapDir = path.join(DATA_DIR, 'snapshots')
const KEEP_DAYS = 3
const day = (t: number) => new Date(t).toLocaleDateString('sv-SE') // YYYY-MM-DD，本地时区
let snapshots: Snapshot[] | null = null
let lastSnapshotAt = 0

async function loadSnapshots(): Promise<Snapshot[]> {
  if (snapshots) return snapshots
  snapshots = []
  const files = (await readdir(snapDir).catch(() => [] as string[])).filter((f) => f.endsWith('.jsonl')).sort()
  for (const f of files.slice(-KEEP_DAYS)) {
    const text = await readFile(path.join(snapDir, f), 'utf8')
    for (const line of text.split('\n')) {
      if (!line.trim()) continue
      try {
        snapshots.push(JSON.parse(line) as Snapshot)
      } catch {}
    }
  }
  snapshots.sort((a, b) => a.at - b.at)
  lastSnapshotAt = snapshots.at(-1)?.at ?? 0
  return snapshots
}

function prune() {
  const cutoff = Date.now() - KEEP_DAYS * 86400_000
  if (snapshots) snapshots = snapshots.filter((s) => s.at >= cutoff)
}

/** 抓取全部热榜并记录快照，返回本次结果（同时用于关键词监控） */
export async function takeSnapshot(): Promise<SourceResult[]> {
  await loadSnapshots()
  const at = Date.now()
  const results = await Promise.all(hotSources.map((s) => getHot(s.id, true)))
  const fresh: Snapshot[] = results
    .filter((r) => r.items.length)
    .map((r) => ({ at, source: r.id, rows: r.items.map((i, n): Row => [i.title, n + 1, i.hotValue ?? null]) }))
  if (fresh.length) {
    await mkdir(snapDir, { recursive: true })
    await appendFile(path.join(snapDir, `${day(at)}.jsonl`), fresh.map((s) => JSON.stringify(s)).join('\n') + '\n')
    snapshots!.push(...fresh)
    prune()
  }
  lastSnapshotAt = at
  return results
}

// ---------- 飙升标记 ----------

export interface Trend {
  type: 'new' | 'up'
  delta?: number
}

const COMPARE_MS = 60 * 60_000 // 和大约 1 小时前的榜单比较
const RISE_MIN = 10 // 排名上升至少 10 位才算飙升

/** 给热榜条目加上「新上榜」「排名飙升」标记 */
export async function annotate(result: SourceResult): Promise<SourceResult & { items: (Item & { trend?: Trend })[] }> {
  const list = (await loadSnapshots()).filter((s) => s.source === result.id)
  const now = Date.now()
  // 取 1 小时前左右的一份快照：至少 45 分钟前、最多 3 小时前
  const base = [...list].reverse().find((s) => now - s.at >= COMPARE_MS * 0.75 && now - s.at <= COMPARE_MS * 3)
  if (!base) return result
  const prevRank = new Map(base.rows.map((r) => [r[0], r[1]]))
  return {
    ...result,
    items: result.items.map((item, n) => {
      const prev = prevRank.get(item.title)
      if (prev === undefined) return { ...item, trend: { type: 'new' } }
      const delta = prev - (n + 1)
      return delta >= RISE_MIN ? { ...item, trend: { type: 'up', delta } } : item
    }),
  }
}

export interface TrendPoint {
  at: number
  rank: number
  hotValue: number | null
}

/** 某个话题在某个榜单上近 3 天的排名和热度变化 */
export async function getTrend(source: string, title: string): Promise<TrendPoint[]> {
  return (await loadSnapshots())
    .filter((s) => s.source === source)
    .flatMap((s) => {
      const row = s.rows.find((r) => r[0] === title)
      return row ? [{ at: s.at, rank: row[1], hotValue: row[2] }] : []
    })
}

// ---------- 关键词监控 ----------

export interface Alert {
  id: string
  at: number
  keyword: string
  source: string
  sourceName: string
  title: string
  url: string
  hot?: string
  rank: number
  read: boolean
}

const alertFile = path.join(DATA_DIR, 'alerts.json')
const MAX_ALERTS = 500

export const listAlerts = () => readJson<Alert[]>(alertFile, [])

export async function markAlertsRead(ids?: string[]) {
  const alerts = await listAlerts()
  for (const a of alerts) if (!ids || ids.includes(a.id)) a.read = true
  await writeJson(alertFile, alerts)
}

export async function clearAlerts() {
  await writeJson(alertFile, [])
}

/** 在热榜里找命中关键词的条目；同一榜单的同一标题只提醒一次 */
async function checkKeywords(results: SourceResult[]): Promise<Alert[]> {
  const c = await getAutomationConfig()
  if (!c.monitor.enabled || !c.monitor.keywords.length) return []
  const alerts = await listAlerts()
  const seen = new Set(alerts.map((a) => `${a.source}|${a.title}`))
  const fresh: Alert[] = []
  for (const r of results) {
    r.items.forEach((item, n) => {
      const kw = c.monitor.keywords.find((k) => item.title.toLowerCase().includes(k.toLowerCase()))
      const key = `${r.id}|${item.title}`
      if (!kw || seen.has(key)) return
      seen.add(key)
      fresh.push({
        id: randomUUID(),
        at: Date.now(),
        keyword: kw,
        source: r.id,
        sourceName: r.name,
        title: item.title,
        url: item.url,
        hot: item.hot,
        rank: n + 1,
        read: false,
      })
    })
  }
  if (!fresh.length) return []
  await writeJson(alertFile, [...fresh, ...alerts].slice(0, MAX_ALERTS))
  if (c.monitor.autoSave) {
    for (const a of fresh) {
      await addFavorite({ title: a.title, url: a.url, source: a.sourceName, tags: ['监控', a.keyword] })
    }
  }
  return fresh
}

// ---------- 每日选题日报 ----------

const reportDir = path.join(DATA_DIR, 'reports')
let generating: Promise<string> | null = null

export async function listReports(): Promise<{ date: string; size: number }[]> {
  const files = (await readdir(reportDir).catch(() => [] as string[])).filter((f) => /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
  const list = await Promise.all(
    files.map(async (f) => ({ date: f.slice(0, 10), size: (await readFile(path.join(reportDir, f), 'utf8')).length })),
  )
  return list.sort((a, b) => b.date.localeCompare(a.date))
}

export async function getReport(date: string): Promise<string | null> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return readFile(path.join(reportDir, `${date}.md`), 'utf8').catch(() => null)
}

/** 生成今天的日报；同一时间只跑一个 */
export function generateDailyReport(): Promise<string> {
  generating ??= (async () => {
    try {
      const date = day(Date.now())
      const body = await chat(await buildPrompt({ task: 'summary' }), AbortSignal.timeout(5 * 60_000))
      if (!body.trim()) throw new Error('AI 没有返回内容')
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      await mkdir(reportDir, { recursive: true })
      await writeFile(path.join(reportDir, `${date}.md`), `# ${date} 选题日报\n\n> 生成于 ${time}\n\n${body}\n`)
      return date
    } finally {
      generating = null
    }
  })()
  return generating
}

// ---------- 调度 ----------

export interface Status {
  lastSnapshotAt: number
  snapshotCount: number
  lastError: string
  dailyRunning: boolean
}
let lastError = ''

export async function getStatus(): Promise<Status> {
  const list = await loadSnapshots()
  return {
    lastSnapshotAt,
    snapshotCount: new Set(list.map((s) => s.at)).size,
    lastError,
    dailyRunning: !!generating,
  }
}

let ticking = false
let lastDailyAttempt = 0
async function tick() {
  if (ticking) return
  ticking = true
  try {
    const c = await getAutomationConfig()
    await loadSnapshots()
    if (Date.now() - lastSnapshotAt >= c.snapshot.intervalMin * 60_000) {
      const results = await takeSnapshot()
      const fresh = await checkKeywords(results)
      if (fresh.length) console.log(`[监控] 新命中 ${fresh.length} 条：${fresh.map((a) => a.title).join('；')}`)
    }
    // 到点且今天还没有日报就生成；后端晚于设定时间启动时也会补上。失败后 30 分钟再试
    const now = new Date()
    const hhmm = now.toTimeString().slice(0, 5)
    if (
      c.daily.enabled &&
      hhmm >= c.daily.time &&
      Date.now() - lastDailyAttempt >= 30 * 60_000 &&
      !(await getReport(day(now.getTime())))
    ) {
      if ((await getAiConfig()).apiKey) {
        lastDailyAttempt = Date.now()
        const date = await generateDailyReport()
        console.log(`[日报] 已生成 ${date}`)
      }
    }
    lastError = ''
  } catch (e) {
    lastError = (e as Error).message
    console.error('[自动化] 执行失败：', lastError)
  } finally {
    ticking = false
  }
}

export function startScheduler() {
  setTimeout(tick, 5_000)
  setInterval(tick, 60_000)
}
