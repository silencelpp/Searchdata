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

export { splitDraft } from '../shared/markdown'

export function usePosts() {
  if (!loaded) {
    loaded = true
    refresh()
  }
  const pending = computed(() => list.value.filter((p) => p.status === 'pending').length)
  return { list, pending, refresh, add, replace, settingsOpen }
}
