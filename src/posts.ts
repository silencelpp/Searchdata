import { computed, ref } from 'vue'
import { api, type Post } from './api'

// 全局共享的待发布队列，任何页面都能把文章加进来
const list = ref<Post[]>([])
const settingsOpen = ref(false)
let loaded = false

async function refresh() {
  list.value = await api.posts()
}

async function add(p: Partial<Post>) {
  const post = await api.createPost(p)
  list.value = [post, ...list.value]
  return post
}

function replace(post: Post) {
  list.value = list.value.map((p) => (p.id === post.id ? post : p))
}

/** 从 AI 初稿里拆出标题：第一个 Markdown 标题，或者第一行 */
export function splitDraft(md: string, fallbackTitle: string) {
  const lines = md.trim().split('\n')
  const i = lines.findIndex((l) => /^#{1,3}\s+\S/.test(l))
  if (i >= 0 && i < 3) {
    return { title: lines[i].replace(/^#+\s+/, '').trim(), content: lines.slice(i + 1).join('\n').trim() }
  }
  return { title: fallbackTitle, content: md.trim() }
}

export function usePosts() {
  if (!loaded) {
    loaded = true
    refresh()
  }
  const pending = computed(() => list.value.filter((p) => p.status === 'pending').length)
  return { list, pending, refresh, add, replace, settingsOpen }
}
