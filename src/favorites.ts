import { computed, ref } from 'vue'
import { api, type Favorite, type Item } from './api'

// 全局共享的收藏状态，热榜/搜索/收藏三个页面都用它
const list = ref<Favorite[]>([])
let loaded = false

export function useFavorites() {
  if (!loaded) {
    loaded = true
    api.favorites().then((v) => (list.value = v))
  }

  const urls = computed(() => new Map(list.value.map((f) => [f.url, f.id])))

  async function toggle(item: Item, source: string) {
    const id = urls.value.get(item.url)
    if (id) {
      await api.removeFavorite(id)
      list.value = list.value.filter((f) => f.id !== id)
    } else {
      const fav = await api.addFavorite({ ...item, source })
      list.value = [fav, ...list.value]
    }
  }

  async function update(id: string, patch: Partial<Favorite>) {
    const fav = await api.updateFavorite(id, patch)
    list.value = list.value.map((f) => (f.id === id ? fav : f))
  }

  async function remove(id: string) {
    await api.removeFavorite(id)
    list.value = list.value.filter((f) => f.id !== id)
  }

  return { list, isFav: (url: string) => urls.value.has(url), toggle, update, remove }
}
