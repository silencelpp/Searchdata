<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAi } from '../ai'
import { api, type SourceInfo, type SourceResult } from '../api'
import ItemRow from './ItemRow.vue'
import TrendChart from './TrendChart.vue'

defineEmits<{ search: [q: string] }>()
const { start } = useAi()

const trend = ref<{ source: string; sourceName: string; title: string } | null>(null)
const onlyRising = ref(false)

const sources = ref<SourceInfo[]>([])
const results = ref<Record<string, SourceResult | undefined>>({})
const loading = ref<Record<string, boolean>>({})
const filter = ref('')

async function load(id: string, force = false) {
  loading.value[id] = true
  try {
    results.value[id] = await api.hot(id, force)
  } catch (e) {
    const name = sources.value.find((s) => s.id === id)?.name ?? id
    results.value[id] = { id, name, items: [], error: (e as Error).message, updatedAt: Date.now() }
  } finally {
    loading.value[id] = false
  }
}

const refreshAll = () => sources.value.forEach((s) => load(s.id, true))

const visible = (r?: SourceResult) =>
  (r?.items ?? []).filter(
    (i) => (!filter.value || i.title.includes(filter.value.trim())) && (!onlyRising.value || i.trend),
  )

const time = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

onMounted(async () => {
  sources.value = (await api.sources()).hot
  sources.value.forEach((s) => load(s.id))
})
</script>

<template>
  <section>
    <div class="toolbar">
      <input v-model="filter" class="input" placeholder="在热榜中筛选，例如：AI、汽车、明星…" />
      <button class="btn" :class="{ on: onlyRising }" title="只看近 1 小时新上榜或排名飙升的话题" @click="onlyRising = !onlyRising">
        {{ onlyRising ? '✓ ' : '' }}只看新上榜/飙升
      </button>
      <button class="btn" @click="refreshAll">全部刷新</button>
      <button class="btn primary" @click="start('summary')">✦ AI 热榜总结</button>
    </div>

    <div class="board-grid">
      <article v-for="s in sources" :key="s.id" class="card">
        <header class="card-head">
          <h3>{{ s.name }}</h3>
          <span v-if="results[s.id]" class="muted">{{ time(results[s.id]!.updatedAt) }}</span>
          <button class="icon" title="刷新" :disabled="loading[s.id]" @click="load(s.id, true)">
            <span :class="{ spin: loading[s.id] }">↻</span>
          </button>
        </header>
        <p v-if="results[s.id]?.error" class="error">加载失败：{{ results[s.id]!.error }}</p>
        <p v-else-if="!results[s.id]" class="muted pad">加载中…</p>
        <p v-else-if="!visible(results[s.id]).length" class="muted pad">
          {{ onlyRising && !filter ? '近 1 小时没有新上榜或飙升的话题（需要后端运行 1 小时以上才有对比数据）' : '没有匹配的条目' }}
        </p>
        <ol v-else class="list">
          <ItemRow
            v-for="(item, i) in visible(results[s.id])"
            :key="item.url"
            :item="item"
            :index="filter ? undefined : i"
            :source="s.name"
            trendable
            @search="$emit('search', $event)"
            @trend="trend = { source: s.id, sourceName: s.name, title: item.title }"
          />
        </ol>
      </article>
    </div>

    <TrendChart v-if="trend" v-bind="trend" @close="trend = null" />
  </section>
</template>
