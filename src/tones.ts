import { ref } from 'vue'

export interface Tone {
  name: string
  desc: string
}

export const MAX_TONES = 3
const KEY = 'article-tones'

// 预设类型从后端拿；上次选的类型存在本地，下次自动带上
const presets = ref<Tone[]>([])
const selected = ref<string[]>(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
let loaded = false

function save(list: string[]) {
  selected.value = list.slice(0, MAX_TONES)
  localStorage.setItem(KEY, JSON.stringify(selected.value))
}

export function useTones() {
  if (!loaded) {
    loaded = true
    fetch('/api/tones')
      .then((r) => r.json())
      .then((v: Tone[]) => (presets.value = v))
      .catch(() => {})
  }
  return { presets, selected, save }
}
