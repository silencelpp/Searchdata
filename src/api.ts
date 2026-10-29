import type { AiConfig } from './ai'

export interface Item {
  title: string
  url: string
  hot?: string
  hotValue?: number
  desc?: string
  author?: string
  time?: string
  /** 热榜专用：和约 1 小时前比，新上榜或排名飙升 */
  trend?: { type: 'new' | 'up'; delta?: number }
}

export interface SourceResult {
  id: string
  name: string
  items: Item[]
  error?: string
  updatedAt: number
}

export interface SourceInfo {
  id: string
  name: string
}

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

export interface TrendPoint {
  at: number
  rank: number
  hotValue: number | null
}

export interface AutomationConfig {
  snapshot: { intervalMin: number }
  monitor: { enabled: boolean; keywords: string[]; autoSave: boolean }
  daily: { enabled: boolean; time: string }
}

export interface AutomationStatus {
  lastSnapshotAt: number
  snapshotCount: number
  lastError: string
  dailyRunning: boolean
}

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

export interface Report {
  date: string
  content: string
}

export interface DocJob {
  id: string
  task: 'analyze' | 'draft'
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

export interface DocFile {
  file: string
  size: number
  createdAt: number
}

export const PUBLISH_PLATFORMS = [
  { id: 'wechat', name: '微信公众号', how: '推到草稿箱' },
  { id: 'xiaohongshu', name: '小红书', how: '浏览器填好' },
  { id: 'toutiao', name: '今日头条', how: '浏览器填好' },
  { id: 'zhihu', name: '知乎', how: '浏览器填好' },
] as const
export type PlatformId = (typeof PUBLISH_PLATFORMS)[number]['id']

export interface PublishResult {
  status: 'running' | 'filled' | 'drafted' | 'error'
  message: string
  at: number
}

export interface Variant {
  title: string
  content: string
  tags: string[]
  cover?: string
}

export interface Issue {
  level: 'error' | 'warn'
  scope: 'main' | PlatformId
  message: string
}

export interface Suggestion {
  find: string
  replace: string
  reason: string
  kind: 'typo' | 'grammar' | 'fact' | 'style'
}

export interface Post {
  id: string
  title: string
  content: string
  summary: string
  tags: string[]
  cover?: string
  variants?: Partial<Record<PlatformId, Variant>>
  status: 'pending' | 'approved'
  platforms: PlatformId[]
  source?: { title: string; url: string }
  results: Partial<Record<PlatformId, PublishResult>>
  createdAt: number
  updatedAt: number
}

export interface PublishConfig {
  wechat: { appId: string; author: string; openComment: boolean; hasSecret: boolean; secretHint: string }
  browser: 'msedge' | 'chrome'
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  })
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.error ?? `请求失败 (${res.status})`)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

export const api = {
  sources: () => request<{ hot: SourceInfo[]; search: SourceInfo[] }>('/api/sources'),
  hot: (id: string, force = false) =>
    request<SourceResult>(`/api/hot/${id}${force ? '?force=1' : ''}`),
  search: (id: string, q: string, page = 1) =>
    request<SourceResult>(`/api/search/${id}?q=${encodeURIComponent(q)}&page=${page}`),
  favorites: () => request<Favorite[]>('/api/favorites'),
  addFavorite: (f: Partial<Favorite>) =>
    request<Favorite>('/api/favorites', { method: 'POST', body: JSON.stringify(f) }),
  updateFavorite: (id: string, patch: Partial<Favorite>) =>
    request<Favorite>(`/api/favorites/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removeFavorite: (id: string) => request<void>(`/api/favorites/${id}`, { method: 'DELETE' }),
  aiConfig: () => request<AiConfig>('/api/ai/config'),
  saveAiConfig: (c: { baseUrl: string; model: string; apiKey: string }) =>
    request<AiConfig>('/api/ai/config', { method: 'PUT', body: JSON.stringify(c) }),
  trend: (source: string, title: string) =>
    request<TrendPoint[]>(`/api/trend?source=${encodeURIComponent(source)}&title=${encodeURIComponent(title)}`),
  automation: () => request<{ config: AutomationConfig; status: AutomationStatus }>('/api/automation'),
  saveAutomation: (c: AutomationConfig) =>
    request<{ config: AutomationConfig; status: AutomationStatus }>('/api/automation', {
      method: 'PUT',
      body: JSON.stringify(c),
    }),
  snapshotNow: () => request<AutomationStatus>('/api/automation/snapshot', { method: 'POST' }),
  alerts: () => request<Alert[]>('/api/alerts'),
  markAlertsRead: (ids?: string[]) =>
    request<void>('/api/alerts/read', { method: 'POST', body: JSON.stringify({ ids }) }),
  clearAlerts: () => request<void>('/api/alerts', { method: 'DELETE' }),
  reports: () => request<{ date: string; size: number }[]>('/api/reports'),
  report: (date: string) => request<Report>(`/api/reports/${date}`),
  generateReport: () => request<Report>('/api/reports', { method: 'POST' }),
  docs: () => request<{ job: DocJob | null; files: DocFile[] }>('/api/docs'),
  startDoc: (body: { ids: string[]; task: 'analyze' | 'draft'; platform: string }) =>
    request<DocJob>('/api/docs', { method: 'POST', body: JSON.stringify(body) }),
  cancelDoc: () => request<void>('/api/docs/cancel', { method: 'POST' }),
  docUrl: (file: string) => `/api/docs/file/${encodeURIComponent(file)}`,
  posts: () => request<Post[]>('/api/posts'),
  createPost: (p: Partial<Post>) => request<Post>('/api/posts', { method: 'POST', body: JSON.stringify(p) }),
  updatePost: (id: string, patch: Partial<Post>) =>
    request<Post>(`/api/posts/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }),
  removePost: (id: string) => request<void>(`/api/posts/${id}`, { method: 'DELETE' }),
  checkPost: (id: string) => request<Issue[]>(`/api/posts/${id}/check`),
  proofread: (id: string, scope: 'main' | PlatformId) =>
    request<Suggestion[]>(`/api/posts/${id}/proofread`, { method: 'POST', body: JSON.stringify({ scope }) }),
  rewrite: (id: string, platform: PlatformId) =>
    request<Post>(`/api/posts/${id}/rewrite`, { method: 'POST', body: JSON.stringify({ platform }) }),
  publish: (id: string, platforms: PlatformId[]) =>
    request<Post>(`/api/posts/${id}/publish`, { method: 'POST', body: JSON.stringify({ platforms }) }),
  upload: (dataUrl: string) =>
    request<{ name: string }>('/api/uploads', { method: 'POST', body: JSON.stringify({ dataUrl }) }),
  uploadUrl: (name: string) => `/api/uploads/${name}`,
  publishConfig: () => request<PublishConfig>('/api/publish/config'),
  savePublishConfig: (c: unknown) =>
    request<PublishConfig>('/api/publish/config', { method: 'PUT', body: JSON.stringify(c) }),
  testWechat: () => request<{ message: string }>('/api/publish/wechat/test', { method: 'POST' }),
  closeBrowser: () => request<void>('/api/publish/browser/close', { method: 'POST' }),
}
