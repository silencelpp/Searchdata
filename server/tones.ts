/** 文章类型 / 语气：生成初稿、批量生成、风格优化时可以选，最多 3 个 */
export const TONES: Record<string, string> = {
  情感: '有情绪感染力，多写人和故事，引起读者共鸣',
  温柔: '语气柔和体贴，像朋友聊天，不说教',
  治愈: '温暖积极，给人安慰和力量',
  幽默: '轻松有梗，适当自嘲，但不低俗',
  犀利: '观点鲜明，一针见血，敢于下判断',
  理性: '逻辑清晰，摆事实讲道理，语气克制',
  专业: '用词准确，有数据和方法论，像行业专家',
  励志: '积极向上，结尾有行动号召',
  接地气: '口语化，用身边的例子，像拉家常',
  文艺: '用词讲究，有画面感和意境',
  悬念: '开头设钩子，层层递进，最后揭晓',
  热血: '节奏快，有冲劲和感染力',
}

const MAX = 3

/** 校验前端传来的类型，返回可以放进提示词的说明；没有选就返回空字符串 */
export function toneText(v: unknown): string {
  if (!Array.isArray(v)) return ''
  const names = [...new Set(v.map((t) => String(t).trim()).filter((t) => t && t.length <= 10))].slice(0, MAX)
  return names.map((n) => (TONES[n] ? `「${n}」（${TONES[n]}）` : `「${n}」`)).join('、')
}
