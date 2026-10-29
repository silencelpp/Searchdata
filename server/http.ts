const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

export async function get(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res
}

export const getJson = async <T = any>(url: string, headers?: Record<string, string>): Promise<T> =>
  (await get(url, headers)).json() as Promise<T>

export const getText = async (url: string, headers?: Record<string, string>): Promise<string> =>
  (await get(url, headers)).text()

// B站接口需要 buvid3 cookie，否则返回 -352 风控错误；从首页响应里拿一个
let biliCookie = ''
export async function biliHeaders(): Promise<Record<string, string>> {
  if (!biliCookie) {
    const res = await get('https://www.bilibili.com/')
    const c = res.headers.getSetCookie().find((c) => c.startsWith('buvid3='))
    biliCookie = c ? c.split(';')[0] : ''
  }
  return { Cookie: biliCookie, Referer: 'https://www.bilibili.com/' }
}

/** 简单的内存缓存，避免频繁请求各平台 */
const cache = new Map<string, { at: number; value: unknown }>()
export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < ttlMs) return hit.value as T
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  return value
}
