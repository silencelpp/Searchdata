/**
 * 小红书、今日头条、知乎：用浏览器自动打开发布页并填好内容，然后停住，由你检查后亲手点发布。
 *
 * - 用系统里已装的 Edge 或 Chrome，带一个独立的浏览器资料目录（data/browser-profile），
 *   所以每个平台只需要第一次扫码登录，之后会记住登录状态。
 * - 不会自动点「发布」按钮，也不会保存你的账号密码。
 * - 各平台改版后页面结构会变，找不到输入框时会把内容复制到剪贴板，提示你手动粘贴。
 */
import path from 'node:path'
import { chromium, type BrowserContext, type Page } from 'playwright-core'
import { toHtml, toPlain } from '../shared/markdown.js'
import { DATA_DIR } from './paths.js'
import { UPLOAD_DIR, type PlatformId, type Post } from './posts.js'
import { getPublishConfig } from './publish-config.js'

interface Target {
  url: string
  /** 页面上出现这些元素之一，说明已登录并进入了编辑页 */
  ready: string[]
  title: string[]
  editor: string[]
  titleMax: number
  /** 小红书图文必须先传图，传完才出现标题和正文框 */
  uploadFirst?: boolean
  /** 正文用纯文本（小红书）还是 HTML */
  plain?: boolean
  /** 话题标签怎么放：追加在正文末尾 */
  tagsInBody?: boolean
}

const TARGETS: Record<Exclude<PlatformId, 'wechat'>, Target> = {
  xiaohongshu: {
    url: 'https://creator.xiaohongshu.com/publish/publish?source=official&target=image',
    ready: ['input[type="file"]', '.upload-input', '.creator-tab'],
    title: ['input[placeholder*="标题"]', '.d-input input', '.title-container input'],
    editor: ['.ql-editor', '.tiptap.ProseMirror', '#post-textarea', '[contenteditable="true"]'],
    titleMax: 20,
    uploadFirst: true,
    plain: true,
    tagsInBody: true,
  },
  toutiao: {
    url: 'https://mp.toutiao.com/profile_v4/graphic/publish',
    ready: ['.ProseMirror', 'textarea[placeholder*="标题"]', '.editor-title'],
    title: ['textarea[placeholder*="标题"]', 'input[placeholder*="标题"]', '.editor-title textarea'],
    editor: ['.ProseMirror', '.syl-editor [contenteditable="true"]', '[contenteditable="true"]'],
    titleMax: 30,
  },
  zhihu: {
    url: 'https://zhuanlan.zhihu.com/write',
    ready: ['.public-DraftEditor-content', 'textarea[placeholder*="标题"]', '.WriteIndex-titleInput'],
    title: ['textarea[placeholder*="标题"]', '.WriteIndex-titleInput textarea', 'input[placeholder*="标题"]'],
    editor: ['.public-DraftEditor-content', '.DraftEditor-root [contenteditable="true"]', '[contenteditable="true"]'],
    titleMax: 100,
  },
}

// 测试时用 PUBLISH_URL_XIAOHONGSHU 等环境变量指向本地模拟页面
const urlOf = (p: keyof typeof TARGETS) => process.env[`PUBLISH_URL_${p.toUpperCase()}`] || TARGETS[p].url

const LOGIN_WAIT_MS = 5 * 60_000
let context: BrowserContext | null = null
let launching: Promise<BrowserContext> | null = null

async function getContext(): Promise<BrowserContext> {
  if (context) return context
  launching ??= (async () => {
    const { browser } = await getPublishConfig()
    try {
      const ctx = await chromium.launchPersistentContext(path.join(DATA_DIR, 'browser-profile'), {
        channel: browser,
        headless: process.env.PUBLISH_HEADLESS === '1',
        viewport: null,
        args: ['--start-maximized'],
      })
      ctx.on('close', () => (context = null))
      context = ctx
      return ctx
    } catch (e) {
      const msg = (e as Error).message
      if (/ProcessSingleton|user data directory is already in use/i.test(msg)) {
        throw new Error('发布用的浏览器已经开着，请先关掉那个浏览器窗口再试')
      }
      throw new Error(`打开浏览器失败：${msg.split('\n')[0]}。可以在「发布设置」里换成 ${browser === 'msedge' ? 'Chrome' : 'Edge'} 试试`)
    } finally {
      launching = null
    }
  })()
  return launching
}

/** 依次尝试多个选择器，返回第一个可见的元素 */
async function first(page: Page, selectors: string[], timeout = 0) {
  const deadline = Date.now() + timeout
  do {
    for (const s of selectors) {
      const loc = page.locator(s).first()
      if (await loc.isVisible().catch(() => false)) return loc
    }
    if (Date.now() < deadline) await page.waitForTimeout(500)
  } while (Date.now() < deadline)
  return null
}

/** 往富文本编辑器里粘贴：模拟一次带 HTML 的粘贴事件，编辑器会按自己的格式处理 */
async function pasteInto(page: Page, selector: string, html: string, text: string) {
  return page.evaluate(
    ({ selector, html, text }) => {
      const el = [...document.querySelectorAll<HTMLElement>(selector)].find((e) => e.offsetParent !== null)
      if (!el) return 0
      el.focus()
      const dt = new DataTransfer()
      if (html) dt.setData('text/html', html)
      dt.setData('text/plain', text)
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
      // 有的编辑器不处理合成的粘贴事件，这时退回到 insertHTML / insertText
      if ((el.innerText || '').trim().length < Math.min(10, text.trim().length)) {
        document.execCommand(html ? 'insertHTML' : 'insertText', false, html || text)
      }
      return (el.innerText || '').trim().length
    },
    { selector, html, text },
  )
}

async function copyToClipboard(page: Page, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})
  return page.evaluate((t) => navigator.clipboard.writeText(t).then(() => true, () => false), text)
}

export async function fillInBrowser(
  platform: keyof typeof TARGETS,
  post: Post,
  progress: (msg: string) => Promise<void>,
): Promise<string> {
  const t = TARGETS[platform]
  if (t.uploadFirst && !post.cover) throw new Error('小红书图文笔记必须有图片，请先上传封面图')

  const ctx = await getContext()
  const page = await ctx.newPage()
  await page.goto(urlOf(platform), { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.bringToFront()

  // 没登录时平台会跳到登录页；等你扫码登录，登录后通常会跳回发布页
  if (!(await first(page, t.ready, 8_000))) {
    await progress('请在弹出的浏览器窗口里登录（扫码即可），登录后会自动继续。只有第一次需要登录')
    const deadline = Date.now() + LOGIN_WAIT_MS
    let ok = false
    while (Date.now() < deadline && !page.isClosed()) {
      if (await first(page, t.ready)) {
        ok = true
        break
      }
      // 登录后停在了别的页面，就重新打开发布页
      if (!/login|passport|signin|sso/i.test(page.url()) && !page.url().startsWith(urlOf(platform).split('?')[0])) {
        await page.goto(urlOf(platform), { waitUntil: 'domcontentloaded' }).catch(() => {})
      }
      await page.waitForTimeout(2_000)
    }
    if (!ok) throw new Error(page.isClosed() ? '浏览器页面被关闭了' : '等了 5 分钟还没登录成功，请重试')
  }
  await progress('已进入发布页，正在填写内容…')

  const notes: string[] = []
  const coverPath = post.cover ? path.join(UPLOAD_DIR, post.cover) : null

  if (t.uploadFirst && coverPath) {
    const input = page.locator('input[type="file"]').first()
    await input.setInputFiles(coverPath)
    // 等图片上传完、标题框出现
    if (!(await first(page, t.title, 30_000))) notes.push('图片已上传，但没等到标题框出现')
  }

  const title = post.title.slice(0, t.titleMax)
  if (post.title.length > t.titleMax) notes.push(`标题超过 ${t.titleMax} 字，已截断，建议手动调整`)
  const titleEl = await first(page, t.title, 10_000)
  if (titleEl) {
    await titleEl.click()
    await titleEl.fill(title)
  } else {
    notes.push('没找到标题输入框，请手动填写标题')
  }

  const tags = post.tags.map((x) => `#${x}`).join(' ')
  const plain = toPlain(post.content) + (t.tagsInBody && tags ? `\n\n${tags}` : '')
  const html = t.plain ? '' : toHtml(post.content)
  let filled = false
  for (const s of t.editor) {
    if (!(await first(page, [s]))) continue
    const len = await pasteInto(page, s, html, plain)
    if (len > 0) {
      filled = true
      break
    }
  }
  if (!filled) {
    const copied = await copyToClipboard(page, plain)
    notes.push(copied ? '没能自动填入正文，正文已复制到剪贴板，请在正文框里按 Ctrl+V 粘贴' : '没能自动填入正文，请从软件里复制正文后粘贴')
  }

  if (!t.uploadFirst && post.cover) notes.push('封面图需要在页面上手动设置')
  if (!t.tagsInBody && post.tags.length) notes.push(`标签/话题请在页面上手动添加：${post.tags.join('、')}`)

  return ['已在浏览器里填好内容，请检查后亲手点「发布」', ...notes].join('；')
}

export async function closeBrowser() {
  await context?.close().catch(() => {})
  context = null
}
