<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, ref, watch } from 'vue'
import { PLATFORMS, useAi, type AiTask } from '../ai'
import type { PlatformId } from '../api'
import { splitDraft, usePosts } from '../posts'
import { useTones } from '../tones'
import TonePicker from './TonePicker.vue'

const { state, run, stop, close } = useAi()
const posts = usePosts()
const copied = ref(false)
const queued = ref(false)

// AI 写作风格对应的发布平台（短视频口播稿没有对应的图文平台）
const STYLE_TO_PLATFORM: Record<string, PlatformId | undefined> = {
  wechat: 'wechat',
  xiaohongshu: 'xiaohongshu',
}

async function queue() {
  if (!state.topic) return
  const { title, content } = splitDraft(state.output, state.topic.title)
  const platform = STYLE_TO_PLATFORM[state.platform]
  await posts.add({
    title,
    content,
    platforms: platform ? [platform] : [],
    source: state.topic.url ? { title: state.topic.title, url: state.topic.url } : undefined,
  })
  queued.value = true
  setTimeout(() => (queued.value = false), 2000)
}

const TASKS: { id: AiTask; name: string }[] = [
  { id: 'analyze', name: '选题分析' },
  { id: 'draft', name: '生成初稿' },
]

const html = computed(() => DOMPurify.sanitize(marked.parse(state.output, { async: false })))

/** 切到「生成初稿」时先让用户选好平台和类型，不直接生成；切到「选题分析」直接跑 */
function switchTask(task: AiTask) {
  if (state.task === task) return
  stop()
  state.task = task
  state.output = ''
  state.error = ''
  if (task === 'draft') state.tones = [...useTones().selected.value]
  else run()
}

/** 已经生成过初稿后又改了平台或类型：提示可以重新生成 */
const changed = ref(false)
watch(() => [state.platform, state.tones.join()], () => (changed.value = state.task === 'draft' && !!state.output))
watch(() => state.loading, (v) => v && (changed.value = false))

async function copy() {
  await navigator.clipboard.writeText(state.output)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div v-if="state.open" class="drawer-mask" @click.self="close">
    <aside class="drawer">
      <header class="drawer-head">
        <h3>{{ state.task === 'summary' ? 'AI 热榜总结' : 'AI 创作助手' }}</h3>
        <button class="icon" title="关闭" @click="close">✕</button>
      </header>

      <div v-if="state.topic" class="drawer-topic">
        <div class="row-title">{{ state.topic.title }}</div>
        <div class="subtabs">
          <button
            v-for="t in TASKS"
            :key="t.id"
            :class="{ active: state.task === t.id }"
            :disabled="state.loading"
            @click="switchTask(t.id)"
          >
            {{ t.name }}
          </button>
        </div>
        <div v-if="state.task === 'draft'" class="draft-setup">
          <div class="history">
            <span class="muted">平台风格：</span>
            <button
              v-for="p in PLATFORMS"
              :key="p.id"
              class="chip"
              :class="{ on: state.platform === p.id }"
              :disabled="state.loading"
              @click="state.platform = p.id"
            >
              {{ p.name }}
            </button>
          </div>
          <TonePicker v-model="state.tones" :disabled="state.loading" />
          <div class="draft-go">
            <span v-if="changed" class="muted">已修改风格设置，点击重新生成</span>
            <button v-if="!state.loading" class="btn primary" @click="run">
              ✦ {{ state.output ? '按新设置重新生成' : '开始生成初稿' }}
            </button>
          </div>
        </div>
      </div>

      <div class="drawer-body">
        <p v-if="state.error" class="error">
          {{ state.error }}
          <button v-if="state.error.includes('API Key')" class="btn" @click="state.settingsOpen = true">去设置</button>
        </p>
        <p v-else-if="state.loading && !state.output" class="muted">AI 正在思考…</p>
        <p v-else-if="state.task === 'draft' && !state.output && !state.loading" class="muted draft-hint">
          选好平台风格和文章类型后，点上面的「开始生成初稿」。
        </p>
        <!-- eslint-disable-next-line vue/no-v-html -- 内容已经过 DOMPurify 清洗 -->
        <article class="markdown" v-html="html" />
      </div>

      <footer class="drawer-foot">
        <span class="muted">AI 生成内容仅供参考，发布前请核实事实</span>
        <button v-if="state.loading" class="btn" @click="stop">停止</button>
        <template v-else>
          <button v-if="state.task !== 'draft' || state.output" class="btn" @click="run">重新生成</button>
          <button
            v-if="state.task === 'draft' && state.output"
            class="btn"
            :title="'把这篇初稿放进「发布」页的待发布队列，审核后再发'"
            @click="queue"
          >
            {{ queued ? '✓ 已加入待发布' : '加入待发布' }}
          </button>
          <button class="btn primary" :disabled="!state.output" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
        </template>
      </footer>
    </aside>
  </div>
</template>
