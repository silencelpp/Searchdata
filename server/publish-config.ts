import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { DATA_DIR } from './paths.js'

export interface PublishConfig {
  wechat: { appId: string; appSecret: string; author: string; openComment: boolean }
  /** 浏览器自动填写用哪个浏览器：Edge 或 Chrome（用系统里已装的） */
  browser: 'msedge' | 'chrome'
}

const file = path.join(DATA_DIR, 'publish-config.json')
const DEFAULT: PublishConfig = {
  wechat: { appId: '', appSecret: '', author: '', openComment: true },
  browser: 'msedge',
}
let config: PublishConfig | null = null

export async function getPublishConfig(): Promise<PublishConfig> {
  if (config) return config
  try {
    const saved = JSON.parse(await readFile(file, 'utf8')) as Partial<PublishConfig>
    config = { ...DEFAULT, ...saved, wechat: { ...DEFAULT.wechat, ...saved.wechat } }
  } catch {
    config = structuredClone(DEFAULT)
  }
  return config
}

/** 给前端看的配置：AppSecret 只显示首尾 */
export async function publicPublishConfig() {
  const c = await getPublishConfig()
  const s = c.wechat.appSecret
  return {
    wechat: { appId: c.wechat.appId, author: c.wechat.author, openComment: c.wechat.openComment, hasSecret: !!s, secretHint: s ? `${s.slice(0, 3)}…${s.slice(-4)}` : '' },
    browser: c.browser,
  }
}

export async function savePublishConfig(input: Record<string, any>) {
  const c = await getPublishConfig()
  const w = input.wechat ?? {}
  const appId = String(w.appId ?? c.wechat.appId).trim()
  if (appId && !/^wx[0-9a-zA-Z]{14,18}$/.test(appId)) throw new Error('AppID 格式不对，应该以 wx 开头')
  config = {
    wechat: {
      appId,
      // 留空表示不修改已保存的 AppSecret
      appSecret: typeof w.appSecret === 'string' && w.appSecret.trim() ? w.appSecret.trim() : c.wechat.appSecret,
      author: String(w.author ?? c.wechat.author).trim().slice(0, 16),
      openComment: Boolean(w.openComment ?? c.wechat.openComment),
    },
    browser: input.browser === 'chrome' ? 'chrome' : input.browser === 'msedge' ? 'msedge' : c.browser,
  }
  await mkdir(DATA_DIR, { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2))
  await rename(tmp, file)
}
