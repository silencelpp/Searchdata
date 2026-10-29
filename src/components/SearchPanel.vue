<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, type SourceInfo, type SourceResult } from '../api'
import ItemRow from './ItemRow.vue'

const keyword = defineModel<string>({ required: true })

const sources = ref<SourceInfo[]>([])
const active = ref('web')
const input = ref(keyword.value)
const results = ref<Record<string, SourceResult>>({})
const pages = ref<Record<string, number>>({})
const loading = ref<Record<string, boolean>>({})
const history = ref<string[]>(JSON.parse(localStorage.getItem('search-history') ?? '[]'))

async function fetchPage(id: string, q: string, page: number) {
  loading.value[id] = true
  try {
    const r = await api.search(id, q, page)
    if (q !== keyword.value) return // 期间换了关键词，丢弃旧结果
    const prev = page > 1 ? results.value[id]?.items ?? [] : []
    const seen = new Set(prev.map((i) => i.url))
    results.value[id] = { ...r, items: [...prev, ...r.items.filter((i) => !seen.has(i.url))] }
    pages.value[id] = page
  } catch (e) {
    results.value[id] = { id, name: id, items: [], error: (e as Error).message, updatedAt: Date.now() }
  } finally {
    loading.value[id] = false
  }
}

function run(q: string) {
  q = q.trim()
  if (!q) return
  results.value = {}
  sources.value.forEach((s) => fetchPage(s.id, q, 1))
  history.value = [q, ...history.value.filter((h) => h !== q)].slice(0, 12)
  localStorage.setItem('search-history', JSON.stringify(history.value))
}

function submit() {
  if (input.value.trim() === keyword.value) run(keyword.value)
  else keyword.value = input.value.trim()
}

function clearHistory() {
  history.value = []
  localStorage.removeItem('search-history')
}

watch(keyword, (q) => {
  input.value = q
  run(q)
})

onMounted(async () => {
  sources.value = (await api.sources()).search
  if (keyword.value) run(keyword.value)
})
</script>

<template>
  <section class="search">
    <form class="toolbar" @submit.prevent="submit">
      <input v-model="input" class="input big" placeholder="输入关键词，同时搜索网页、公众号、B站…" autofocus />
      <button class="btn primary" type="submit">搜索</button>
    </form>

    <div v-if="history.length" class="history">
      <span class="muted">最近搜索：</span>
      <button v-for="h in history" :key="h" class="chip" @click="keyword = h">{{ h }}</button>
      <button class="link" @click="clearHistory">清空</button>
    </div>

    <template v-if="keyword">
      <div class="subtabs">
        <button
          v-for="s in sources"
          :key="s.id"
          :class="{ active: active === s.id }"
          @click="active = s.id"
        >
          {{ s.name }}
          <span v-if="loading[s.id] && !results[s.id]" class="muted">…</span>
          <span v-else-if="results[s.id]" class="muted">{{ results[s.id].items.length }}</span>
        </button>
      </div>

      <div class="card">
        <p v-if="results[active]?.error" class="error">搜索失败：{{ results[active].error }}</p>
        <p v-else-if="!results[active]" class="muted pad">搜索中…</p>
        <p v-else-if="!results[active].items.length" class="muted pad">没有找到结果</p>
        <template v-else>
          <ul class="list">
            <ItemRow
              v-for="item in results[active].items"
              :key="item.url"
              :item="item"
              :source="results[active].name"
              show-desc
              @search="keyword = $event"
            />
          </ul>
          <div class="more">
            <button class="btn" :disabled="loading[active]" @click="fetchPage(active, keyword, (pages[active] ?? 1) + 1)">
              {{ loading[active] ? '加载中…' : '加载更多' }}
            </button>
          </div>
        </template>
      </div>
    </template>
    <p v-else class="empty muted">在「全网热榜」里点 ⌕ 可以直接搜索某个热点</p>
  </section>
</template>
