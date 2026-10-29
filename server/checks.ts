/**
 * 发布前检查：审核通过前跑一遍，找出会导致发布失败或明显有问题的地方。
 * - error：必须改，否则不能审核通过（标题超长、缺封面、还有【待补充】等）
 * - warn：提醒你看一眼（广告法敏感词、小红书引流词等），可能是误报
 */
import { toPlain } from './markdown.js'
import { PLATFORMS, resolveVersion, type PlatformId, type Post } from './posts.js'

export interface Issue {
  level: 'error' | 'warn'
  /** main 表示通用版本，否则是某个平台的专属版本 */
  scope: 'main' | PlatformId
  message: string
}

export const TITLE_LIMIT: Record<PlatformId, number> = { wechat: 64, xiaohongshu: 20, toutiao: 30, zhihu: 100 }
/** 头条标题至少 2 个字，否则发布页会报错 */
const TITLE_MIN: Partial<Record<PlatformId, number>> = { toutiao: 2 }
const XHS_BODY_LIMIT = 1000
const XHS_TAG_LIMIT = 10
const NEED_COVER: PlatformId[] = ['wechat', 'xiaohongshu']

// 《广告法》禁用的绝对化用语和夸大用语（常见的部分）。普通文章里也可能正常出现，所以只做提醒
const AD_WORDS = [
  '全网第一', '行业第一', '销量第一', '排名第一', '第一品牌', 'NO.1', 'No.1', 'TOP1', 'Top1',
  '史上最', '全网最', '最好', '最佳', '最强', '最低价', '最便宜', '最先进', '最高级', '最优秀', '最受欢迎',
  '唯一', '独一无二', '顶级', '极致', '国家级', '世界级', '绝对', '100%', '万能', '永久', '首选', '王牌',
  '根治', '零风险', '无副作用', '秒杀', '抢爆', '再不抢就没了',
]

// 小红书限制站外引流，这些词容易被限流
const XHS_DIVERSION = ['微信', 'vx', 'VX', 'wx', '加v', '加V', '私信我', '二维码', '淘宝', '拼多多', '京东', '公众号']

function count(text: string, word: string) {
  let n = 0
  for (let i = text.indexOf(word); i >= 0; i = text.indexOf(word, i + word.length)) n++
  return n
}

function contentIssues(scope: Issue['scope'], title: string, content: string, xhs: boolean): Issue[] {
  const issues: Issue[] = []
  const text = `${title}\n${content}`
  if (!title.trim()) issues.push({ level: 'error', scope, message: '标题是空的' })
  if (!content.trim()) issues.push({ level: 'error', scope, message: '正文是空的' })

  const todo = content.match(/【待补充[^】]*】/g)
  if (todo) issues.push({ level: 'error', scope, message: `还有 ${todo.length} 处【待补充】没有填写：${todo.slice(0, 3).join('、')}` })

  const ad = AD_WORDS.map((w) => [w, count(text, w)] as const).filter(([, n]) => n > 0)
  if (ad.length) {
    issues.push({
      level: 'warn',
      scope,
      message: `可能违反广告法的用语：${ad.map(([w, n]) => (n > 1 ? `「${w}」×${n}` : `「${w}」`)).join(' ')}。如果是正常表述可以忽略`,
    })
  }

  if (xhs) {
    const words = XHS_DIVERSION.filter((w) => text.includes(w))
    if (/https?:\/\//.test(content)) words.push('网址链接')
    if (words.length) issues.push({ level: 'warn', scope, message: `小红书限制站外引流，这些内容可能导致限流：${words.join('、')}` })
  }
  return issues
}

export function checkPost(post: Post): Issue[] {
  const issues: Issue[] = []
  const platforms = post.platforms
  if (!platforms.length) issues.push({ level: 'error', scope: 'main', message: '还没有选择发布平台' })

  // 内容类检查：通用版本检查一次，每个专属版本各检查一次，避免重复报告
  const usesMain = platforms.filter((p) => !post.variants?.[p])
  if (usesMain.length || !platforms.length) {
    issues.push(...contentIssues('main', post.title, post.content, usesMain.includes('xiaohongshu')))
  }
  for (const p of platforms) {
    const v = post.variants?.[p]
    if (v) issues.push(...contentIssues(p, v.title, v.content, p === 'xiaohongshu'))
  }

  // 平台类检查：用这个平台实际会发出去的版本
  for (const p of platforms) {
    const v = resolveVersion(post, p)
    const scope: Issue['scope'] = post.variants?.[p] ? p : 'main'
    const name = PLATFORMS[p]
    if (v.title.trim() && v.title.trim().length < (TITLE_MIN[p] ?? 0)) {
      issues.push({ level: 'error', scope, message: `${name}标题至少 ${TITLE_MIN[p]} 个字` })
    }
    if (v.title.length > TITLE_LIMIT[p]) {
      issues.push({
        level: 'error',
        scope,
        message: `${name}标题最多 ${TITLE_LIMIT[p]} 字，现在 ${v.title.length} 字${scope === 'main' ? `。可以缩短标题，或者为${name}单独做一个版本` : ''}`,
      })
    }
    if (NEED_COVER.includes(p) && !v.cover) issues.push({ level: 'error', scope, message: `${name}必须有封面图` })
    if (p === 'xiaohongshu') {
      const len = toPlain(v.content).length + v.tags.map((t) => `#${t} `).join('').length
      if (len > XHS_BODY_LIMIT) {
        issues.push({
          level: 'error',
          scope,
          message: `小红书正文最多 ${XHS_BODY_LIMIT} 字，现在约 ${len} 字${scope === 'main' ? '。建议用「AI 改写」生成小红书版本' : ''}`,
        })
      }
      if (v.tags.length > XHS_TAG_LIMIT) issues.push({ level: 'warn', scope, message: `小红书话题建议不超过 ${XHS_TAG_LIMIT} 个，现在 ${v.tags.length} 个` })
    }
  }
  return issues
}
