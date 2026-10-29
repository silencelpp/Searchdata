<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { PUBLISH_PLATFORMS, type Post } from '../api'
import { openPostId } from '../nav'
import { usePosts } from '../posts'
import PostEditor from './PostEditor.vue'

const { list, refresh, add } = usePosts()

const filter = ref<'all' | 'pending' | 'approved'>('all')
const activeId = ref<string | null>(null)

const filtered = computed(() => list.value.filter((p) => filter.value === 'all' || p.status === filter.value))
const name = (id: string) => PUBLISH_PLATFORMS.find((x) => x.id === id)?.name ?? id
const STATUS_TEXT = { running: '进行中', filled: '已填好，待你发布', drafted: '已进草稿箱', error: '失败' }
const fmt = (t: number) => new Date(t).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })

function open(p: Post) {
  activeId.value = p.id
}

async function newPost() {
  const p = await add({ title: '新文章', content: '' })
  filter.value = 'all'
  open(p)
}

function pick() {
  // 从「创作」页跳过来时打开指定文章，否则打开第一篇
  if (openPostId.value && list.value.some((p) => p.id === openPostId.value)) activeId.value = openPostId.value
  else if (!list.value.some((p) => p.id === activeId.value)) activeId.value = list.value[0]?.id ?? null
  openPostId.value = null
}

watch(openPostId, (v) => v && pick())

onMounted(async () => {
  await refresh()
  pick()
})
</script>

<template>
  <section class="publish">
    <aside class="card post-list">
      <header class="card-head">
        <h3>我的文章</h3>
        <button class="btn" @click="newPost">＋ 新建</button>
      </header>
      <div class="subtabs pad-x">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'pending' }" @click="filter = 'pending'">待审核</button>
        <button :class="{ active: filter === 'approved' }" @click="filter = 'approved'">已通过</button>
      </div>
      <p v-if="!filtered.length" class="muted pad">
        还没有文章。去「✦ 一键生成」写几篇，或者点上面的「新建」。
      </p>
      <ul class="list">
        <li v-for="p in filtered" :key="p.id" class="post-item" :class="{ on: p.id === activeId }" @click="open(p)">
          <div class="row-title">{{ p.title }}</div>
          <div class="row-meta">
            <span class="state" :class="p.status">{{ p.status === 'approved' ? '已通过' : '待审核' }}</span>
            <span>{{ fmt(p.updatedAt) }}</span>
            <span v-for="(r, k) in p.results" :key="k" :class="['dot', r?.status]" :title="`${name(k)}：${r ? STATUS_TEXT[r.status] : ''}`" />
          </div>
        </li>
      </ul>
    </aside>

    <PostEditor v-if="activeId" :key="activeId" :post-id="activeId" @deleted="activeId = null; pick()" />
    <div v-else class="card post-editor empty-editor">
      <p class="muted">在左边选一篇文章</p>
    </div>
  </section>
</template>
