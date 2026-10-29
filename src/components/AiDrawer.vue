<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, ref } from 'vue'
import { PLATFORMS, useAi, type AiTask } from '../ai'

const { state, run, stop, close } = useAi()
const copied = ref(false)

const TASKS: { id: AiTask; name: string }[] = [
  { id: 'analyze', name: '选题分析' },
  { id: 'draft', name: '生成初稿' },
]

const html = computed(() => DOMPurify.sanitize(marked.parse(state.output, { async: false })))

function switchTask(task: AiTask) {
  if (state.task === task) return
  state.task = task
  run()
}

function switchPlatform(id: string) {
  state.platform = id
  run()
}

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
        <div v-if="state.task === 'draft'" class="history">
          <span class="muted">平台风格：</span>
          <button
            v-for="p in PLATFORMS"
            :key="p.id"
            class="chip"
            :class="{ on: state.platform === p.id }"
            :disabled="state.loading"
            @click="switchPlatform(p.id)"
          >
            {{ p.name }}
          </button>
        </div>
      </div>

      <div class="drawer-body">
        <p v-if="state.error" class="error">
          {{ state.error }}
          <button v-if="state.error.includes('API Key')" class="btn" @click="state.settingsOpen = true">去设置</button>
        </p>
        <p v-else-if="state.loading && !state.output" class="muted">AI 正在思考…</p>
        <!-- eslint-disable-next-line vue/no-v-html -- 内容已经过 DOMPurify 清洗 -->
        <article class="markdown" v-html="html" />
      </div>

      <footer class="drawer-foot">
        <span class="muted">AI 生成内容仅供参考，发布前请核实事实</span>
        <button v-if="state.loading" class="btn" @click="stop">停止</button>
        <template v-else>
          <button class="btn" @click="run">重新生成</button>
          <button class="btn primary" :disabled="!state.output" @click="copy">{{ copied ? '已复制' : '复制' }}</button>
        </template>
      </footer>
    </aside>
  </div>
</template>
