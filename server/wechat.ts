/**
 * 微信公众号：用官方接口把文章推到草稿箱，不直接群发。
 * 你在公众号后台的草稿箱里检查后，自己点发布。
 * 需要在公众号后台拿 AppID / AppSecret，并把本机的出口 IP 加进 IP 白名单。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getPublishConfig } from './publish-config.js'
import { toWechatHtml } from '../shared/markdown.js'
import { UPLOAD_DIR, type Post } from './posts.js'

// 测试时可以指向模拟接口
const API = process.env.WECHAT_API_BASE || 'https://api.weixin.qq.com'

let token: { value: string; appId: string; expiresAt: number } | null = null

/** 常见错误码翻译成中文提示 */
function explain(code: number, msg: string) {
  const hints: Record<number, string> = {
    40001: 'AppSecret 不对，或者 access_token 已失效',
    40013: 'AppID 不对',
    40125: 'AppSecret 不对',
    40164: '本机 IP 不在公众号的 IP 白名单里。到公众号后台「设置与开发 → 基本配置 → IP 白名单」添加本机出口 IP',
    41001: '缺少 access_token',
    45009: '接口调用次数超过今日上限',
    48001: '这个公众号没有调用该接口的权限（个人号或未认证号可能受限）',
    53404: '账号已被限制群发',
    40007: '封面素材无效，请重新上传封面',
  }
  const ip = msg.match(/(\d{1,3}(?:\.\d{1,3}){3})/)?.[1]
  const base = hints[code] ?? msg
  return `${base}（错误码 ${code}${code === 40164 && ip ? `，本机出口 IP：${ip}` : ''}）`
}

async function call<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  const j = (await res.json()) as any
  if (j.errcode) throw new Error(explain(j.errcode, j.errmsg ?? ''))
  return j as T
}

async function getToken(): Promise<string> {
  const { wechat } = await getPublishConfig()
  if (!wechat.appId || !wechat.appSecret) throw new Error('还没有填写公众号的 AppID 和 AppSecret，请先在「发布设置」里填写')
  if (token && token.appId === wechat.appId && token.expiresAt > Date.now() + 60_000) return token.value
  const j = await call<{ access_token: string; expires_in: number }>(`${API}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credential', appid: wechat.appId, secret: wechat.appSecret }),
  })
  token = { value: j.access_token, appId: wechat.appId, expiresAt: Date.now() + j.expires_in * 1000 }
  return token.value
}

/** 测试连接：能拿到 access_token 就说明 AppID、AppSecret、IP 白名单都对 */
export async function testWechat() {
  token = null
  await getToken()
  return '连接成功，AppID、AppSecret 和 IP 白名单都没问题'
}

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }

/** 封面上传为永久图片素材，拿到 media_id */
async function uploadCover(name: string): Promise<string> {
  const ext = name.split('.').pop()!
  if (ext !== 'jpg' && ext !== 'png') throw new Error('公众号封面只支持 JPG 或 PNG 图片')
  const buf = await readFile(path.join(UPLOAD_DIR, name))
  const form = new FormData()
  form.append('media', new Blob([buf], { type: MIME[ext] }), `cover.${ext}`)
  const j = await call<{ media_id: string }>(`${API}/cgi-bin/material/add_material?access_token=${await getToken()}&type=image`, {
    method: 'POST',
    body: form,
  })
  return j.media_id
}

export async function pushWechatDraft(post: Post): Promise<string> {
  if (!post.cover) throw new Error('公众号文章必须有封面，请先上传封面图')
  const { wechat } = await getPublishConfig()
  const thumb = await uploadCover(post.cover)
  // 公众号正文里的外链图片会被过滤，这里先去掉，免得出现空白
  const content = toWechatHtml(post.content.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))
  const j = await call<{ media_id: string }>(`${API}/cgi-bin/draft/add?access_token=${await getToken()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      articles: [
        {
          article_type: 'news',
          title: post.title.slice(0, 64),
          author: wechat.author.slice(0, 16) || undefined,
          digest: post.summary.slice(0, 120) || undefined,
          content,
          content_source_url: post.source?.url,
          thumb_media_id: thumb,
          need_open_comment: wechat.openComment ? 1 : 0,
          only_fans_can_comment: 0,
        },
      ],
    }),
  })
  return `已推送到公众号草稿箱（media_id: ${j.media_id}）。请到公众号后台「内容管理 → 草稿箱」检查后发布`
}
