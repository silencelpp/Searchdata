import * as cheerio from 'cheerio'
import { fmt } from './hot.js'
import { biliHeaders, cached, getJson, getText } from './http.js'
import type { Item, SourceResult } from './types.js'

const stripTags = (s: string) => cheerio.load(s).text().trim()

interface SearchSource {
  id: string
  name: string
  search: (q: string, page: number) => Promise<Item[]>
}

export const searchSources: SearchSource[] = [
  {
    id: 'web',
    name: '网页 (Bing)',
    async search(q, page) {
      const html = await getText(
        `https://cn.bing.com/search?q=${encodeURIComponent(q)}&first=${(page - 1) * 10 + 1}`,
      )
      const $ = cheerio.load(html)
      return $('li.b_algo')
        .map((_, el) => {
          const a = $(el).find('h2 a').first()
          return {
            title: a.text().trim(),
            url: a.attr('href') ?? '',
            desc: $(el).find('.b_caption p, p.b_lineclamp2, p.b_lineclamp3').first().text().trim(),
          }
        })
        .get()
        .filter((x) => x.title && x.url.startsWith('http'))
    },
  },
  {
    id: 'wechat',
    name: '公众号文章',
    async search(q, page) {
      const html = await getText(
        `https://weixin.sogou.com/weixin?type=2&query=${encodeURIComponent(q)}&page=${page}`,
      )
      const $ = cheerio.load(html)
      return $('.txt-box')
        .map((_, el) => {
          const a = $(el).find('h3 a').first()
          const href = a.attr('href') ?? ''
          const ts = ($(el).find('.s2').html() ?? '').match(/timeConvert\('(\d+)'\)/)?.[1]
          return {
            title: a.text().trim(),
            url: href.startsWith('http') ? href : `https://weixin.sogou.com${href}`,
            desc: $(el).find('.txt-info').text().trim(),
            author: $(el).find('.all-time-y2').text().trim(),
            time: ts ? new Date(Number(ts) * 1000).toLocaleDateString('zh-CN') : undefined,
          }
        })
        .get()
        .filter((x) => x.title)
    },
  },
  {
    id: 'bilibili',
    name: 'B站视频',
    async search(q, page) {
      const j = await getJson(
        `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(q)}&page=${page}`,
        await biliHeaders(),
      )
      if (j.code !== 0) throw new Error(j.message)
      return ((j.data.result ?? []) as any[]).map((x) => ({
        title: stripTags(x.title),
        url: `https://www.bilibili.com/video/${x.bvid}`,
        desc: x.description,
        author: x.author,
        hot: `${fmt(x.play)}播放`,
        time: new Date(x.pubdate * 1000).toLocaleDateString('zh-CN'),
      }))
    },
  },
]

export async function search(id: string, q: string, page: number): Promise<SourceResult> {
  const src = searchSources.find((s) => s.id === id)
  if (!src) throw new Error(`未知来源: ${id}`)
  try {
    const items = await cached(`search:${id}:${q}:${page}`, 10 * 60_000, () => src.search(q, page))
    return { id, name: src.name, items, updatedAt: Date.now() }
  } catch (e) {
    return { id, name: src.name, items: [], error: (e as Error).message, updatedAt: Date.now() }
  }
}
