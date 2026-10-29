<script setup lang="ts">
import { computed, ref } from 'vue'
import { useAi } from '../ai'
import { goCreate } from '../nav'
import type { Favorite } from '../api'
import { useFavorites } from '../favorites'
import DocsDialog from './DocsDialog.vue'

defineEmits<{ search: [q: string] }>()
const { list, update, remove } = useFavorites()
const { start } = useAi()

// 批量生成文档：先进入选择模式勾选素材，再打开生成对话框
const selecting = ref(false)
const selected = ref(new Set<string>())
const docsOpen = ref(false)
const selectedItems = computed(() => list.value.filter((f) => selected.value.has(f.id)))

function toggleSelect(id: string) {
  const next = new Set(selected.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  selected.value = next
}

function selectAllFiltered() {
  selected.value = new Set([...selected.value, ...filtered.value.map((f) => f.id)])
}

function exitSelect() {
  selecting.value = false
  selected.value = new Set()
}

const aiTopic = (f: Favorite) => ({ title: f.title, desc: f.desc, source: f.source, note: f.note, url: f.url })

const text = ref('')
const tag = ref('')
const editing = ref<string | null>(null)
const draftNote = ref('')
const draftTags = ref('')

const allTags = computed(() => [...new Set(list.value.flatMap((f) => f.tags))])

const filtered = computed(() =>
  list.value.filter((f) => {
    if (tag.value && !f.tags.includes(tag.value)) return false
    const t = text.value.trim()
    return !t || f.title.includes(t) || f.note.includes(t) || (f.desc ?? '').includes(t)
  }),
)

function edit(f: Favorite) {
  editing.value = f.id
  draftNote.value = f.note
  draftTags.value = f.tags.join(' ')
}

async function save(f: Favorite) {
  const tags = draftTags.value.split(/[\s,，]+/).filter(Boolean)
  await update(f.id, { note: draftNote.value, tags })
  editing.value = null
}

async function del(f: Favorite) {
  if (confirm(`删除「${f.title}」？`)) await remove(f.id)
}

const date = (t: number) => new Date(t).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })
</script>

<template>
  <section>
    <div class="toolbar">
      <input v-model="text" class="input" placeholder="搜索素材标题、描述、笔记…" />
      <button v-if="!selecting" class="btn primary" :disabled="!list.length" @click="selecting = true">📄 批量生成文档</button>
      <button v-if="!selecting" class="btn" title="查看已生成的文档" @click="docsOpen = true">历史文档</button>
    </div>
    <div v-if="selecting" class="select-bar">
      <span>已选 <strong>{{ selected.size }}</strong> 条</span>
      <button class="link" @click="selectAllFiltered">全选当前列表</button>
      <button v-if="selected.size" class="link" @click="selected = new Set()">清空</button>
      <span class="spacer" />
      <button class="btn" @click="exitSelect">取消</button>
      <button class="btn primary" :disabled="!selected.size" @click="docsOpen = true">下一步：生成文档</button>
    </div>
    <div v-if="allTags.length" class="history">
      <span class="muted">标签：</span>
      <button class="chip" :class="{ on: !tag }" @click="tag = ''">全部</button>
      <button v-for="t in allTags" :key="t" class="chip" :class="{ on: tag === t }" @click="tag = t">
        #{{ t }}
      </button>
    </div>

    <p v-if="!list.length" class="empty muted">素材库还是空的。在热榜或搜索结果里点 ☆ 收藏选题。</p>
    <p v-else-if="!filtered.length" class="empty muted">没有匹配的素材</p>

    <div class="fav-list">
      <article
        v-for="f in filtered"
        :key="f.id"
        class="card fav"
        :class="{ picked: selecting && selected.has(f.id) }"
        @click="selecting && toggleSelect(f.id)"
      >
        <div class="fav-head">
          <label v-if="selecting" class="fav-check" @click.stop>
            <input type="checkbox" :checked="selected.has(f.id)" @change="toggleSelect(f.id)" />
          </label>
          <a :href="f.url" target="_blank" rel="noopener noreferrer" class="row-title" @click="selecting && $event.preventDefault()">{{ f.title }}</a>
          <div v-if="!selecting" class="row-actions">
            <button class="icon" title="AI 选题分析（会参考你的笔记）" @click="start('analyze', aiTopic(f))">✦</button>
            <button class="icon" title="写一篇：带着这个选题去创作" @click="goCreate(aiTopic(f))">✍</button>
            <button class="icon" title="全网搜索" @click="$emit('search', f.title)">⌕</button>
            <button class="icon" title="编辑笔记和标签" @click="edit(f)">✎</button>
            <button class="icon" title="删除" @click="del(f)">✕</button>
          </div>
        </div>
        <div class="row-meta">
          <span class="badge">{{ f.source }}</span>
          <span>{{ date(f.createdAt) }}</span>
          <span v-for="t in f.tags" :key="t" class="tag">#{{ t }}</span>
        </div>
        <p v-if="f.desc" class="row-desc">{{ f.desc }}</p>

        <div v-if="editing === f.id" class="editor">
          <textarea v-model="draftNote" class="input" rows="3" placeholder="写点选题思路、切入角度…" />
          <input v-model="draftTags" class="input" placeholder="标签，用空格分隔，例如：科技 待写" />
          <div class="editor-actions">
            <button class="btn" @click="editing = null">取消</button>
            <button class="btn primary" @click="save(f)">保存</button>
          </div>
        </div>
        <p v-else-if="f.note" class="note">{{ f.note }}</p>
      </article>
    </div>

    <DocsDialog v-if="docsOpen" :items="selectedItems" @close="docsOpen = false" />
  </section>
</template>
