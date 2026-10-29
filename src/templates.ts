import { ref } from 'vue'

export interface Template {
  id: string
  name: string
  desc: string
  structure: string
}

const KEY = 'article-template'

// 预设模版从后端拿；上次选的模版和自定义结构存在本地
const presets = ref<Template[]>([])
const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { id?: string; custom?: string }
const selected = ref<string>(saved.id ?? '')
const custom = ref<string>(saved.custom ?? '')
let loaded = false

function save(id: string, text: string) {
  selected.value = id
  custom.value = text
  localStorage.setItem(KEY, JSON.stringify({ id, custom: text }))
}

export function useTemplates() {
  if (!loaded) {
    loaded = true
    fetch('/api/templates')
      .then((r) => r.json())
      .then((v: Template[]) => (presets.value = v))
      .catch(() => {})
  }
  return { presets, selected, custom, save }
}
