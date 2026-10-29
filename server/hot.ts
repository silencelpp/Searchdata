import { biliHeaders, cached, getJson } from './http.js'
import type { Item, SourceResult } from './types.js'

export const fmt = (n: number) => (n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n))

/** 知乎热度是「332 万热度」这样的文本，转成数字 */
function parseZhihuHot(s?: string) {
  const m = s?.match(/([\d.]+)\s*(万|亿)?/)
  if (!m) return undefined
  return Math.round(Number(m[1]) * (m[2] === '亿' ? 1e8 : m[2] === '万' ? 1e4 : 1))
}

interface HotSource {
  id: string
  name: string
  fetch: () => Promise<Item[]>
}

export const hotSources: HotSource[] = [
  {
    id: 'weibo',
    name: '微博热搜',
    async fetch() {
      const j = await getJson('https://weibo.com/ajax/side/hotSearch', {
        Referer: 'https://weibo.com/',
        'X-Requested-With': 'XMLHttpRequest',
      })
      return (j.data.realtime as any[])
        .filter((x) => !x.is_ad)
        .map((x) => ({
          title: x.word,
          url: `https://s.weibo.com/weibo?q=${encodeURIComponent(`#${x.word}#`)}`,
          hot: x.num ? fmt(x.num) : undefined,
          hotValue: x.num || undefined,
        }))
    },
  },
  {
    id: 'zhihu',
    name: '知乎热榜',
    async fetch() {
      const j = await getJson('https://api.zhihu.com/topstory/hot-list?limit=50')
      return (j.data as any[]).map((x) => ({
        title: x.target.title,
        url: `https://www.zhihu.com/question/${String(x.card_id).replace(/^Q_/, '')}`,
        hot: x.detail_text,
        hotValue: parseZhihuHot(x.detail_text),
        desc: x.target.excerpt,
      }))
    },
  },
  {
    id: 'douyin',
    name: '抖音热点',
    async fetch() {
      const j = await getJson('https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/')
      return (j.word_list as any[]).map((x) => ({
        title: x.word,
        url: `https://www.douyin.com/search/${encodeURIComponent(x.word)}`,
        hot: fmt(x.hot_value),
        hotValue: x.hot_value,
      }))
    },
  },
  {
    id: 'bilibili',
    name: 'B站热门',
    async fetch() {
      const j = await getJson(
        'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
        await biliHeaders(),
      )
      if (j.code !== 0) throw new Error(j.message)
      return (j.data.list as any[]).map((x) => ({
        title: x.title,
        url: `https://www.bilibili.com/video/${x.bvid}`,
        hot: `${fmt(x.stat.view)}播放`,
        hotValue: x.stat.view,
        desc: x.desc,
        author: x.owner?.name,
      }))
    },
  },
  {
    id: 'baidu',
    name: '百度热搜',
    async fetch() {
      // PC 版接口带热度分数，移动版没有
      const j = await getJson('https://top.baidu.com/api/board?platform=pc&tab=realtime')
      const list = j.data.cards[0].content as any[]
      return list.map((x) => ({
        title: x.word,
        url: `https://www.baidu.com/s?wd=${encodeURIComponent(x.word)}`,
        desc: x.desc,
        hot: x.hotScore ? fmt(Number(x.hotScore)) : undefined,
        hotValue: Number(x.hotScore) || undefined,
      }))
    },
  },
  {
    id: 'toutiao',
    name: '今日头条',
    async fetch() {
      // ClusterId 超出 JS 安全整数范围，所以直接用接口返回的 Url
      const j = await getJson('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc')
      return (j.data as any[]).map((x) => ({
        title: x.Title,
        url: String(x.Url).split('?')[0],
        hot: x.HotValue ? fmt(Number(x.HotValue)) : undefined,
        hotValue: Number(x.HotValue) || undefined,
      }))
    },
  },
]

export async function getHot(id: string, force = false): Promise<SourceResult> {
  const src = hotSources.find((s) => s.id === id)
  if (!src) throw new Error(`未知来源: ${id}`)
  const ttl = force ? 0 : 5 * 60_000
  try {
    const items = await cached(`hot:${id}`, ttl, src.fetch)
    return { id, name: src.name, items, updatedAt: Date.now() }
  } catch (e) {
    return { id, name: src.name, items: [], error: (e as Error).message, updatedAt: Date.now() }
  }
}
