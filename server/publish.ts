import { fillInBrowser } from './browser-publish.js'
import { checkPost } from './checks.js'
import { getPost, resolveVersion, setResult, type PlatformId } from './posts.js'
import { pushWechatDraft } from './wechat.js'

const running = new Set<string>()

/** 把一篇已审核的文章发到选中的平台；在后台逐个平台执行，结果写回文章 */
export async function publish(id: string, platforms: PlatformId[]) {
  const post = await getPost(id)
  if (!post) throw new Error('文章不存在')
  if (post.status !== 'approved') throw new Error('请先审核通过再发布')
  if (!platforms.length) throw new Error('请至少选择一个平台')
  // 审核后可能又改了平台选择，发布前再检查一次
  const errors = checkPost({ ...post, platforms }).filter((i) => i.level === 'error')
  if (errors.length) throw new Error(`发布前检查没通过：${errors.map((i) => i.message).join('；')}`)
  const busy = platforms.filter((p) => running.has(`${id}:${p}`))
  if (busy.length) throw new Error('这篇文章正在发布中，请等它完成')

  for (const p of platforms) {
    running.add(`${id}:${p}`)
    await setResult(id, p, { status: 'running', message: '排队中…' })
  }

  // 浏览器自动化一次只开一个平台的页面，按顺序执行，避免多个登录窗口同时弹出
  ;(async () => {
    for (const p of platforms) {
      try {
        const progress = (message: string) => setResult(id, p, { status: 'running', message })
        await progress(p === 'wechat' ? '正在推送到公众号草稿箱…' : '正在打开浏览器…')
        // 每个平台用自己的版本（没有专属版本就是通用版本）
        const version = { ...post, ...resolveVersion(post, p) }
        const message = p === 'wechat' ? await pushWechatDraft(version) : await fillInBrowser(p, version, progress)
        await setResult(id, p, { status: p === 'wechat' ? 'drafted' : 'filled', message })
      } catch (e) {
        await setResult(id, p, { status: 'error', message: (e as Error).message })
      } finally {
        running.delete(`${id}:${p}`)
      }
    }
  })()
}
