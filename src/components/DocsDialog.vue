<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { PLATFORMS, useAi } from '../ai'
import { api, type DocFile, type DocJob, type Favorite } from '../api'

const props = defineProps<{ items: Favorite[] }>()
const emit = defineEmits<{ close: []; done: [] }>()
const { state: ai } = useAi()

const task = ref<'analyze' | 'draft'>('analyze')
const platform = ref('wechat')
const job = ref<DocJob | null>(null)
const files = ref<DocFile[]>([])
const error = ref('')
const hasKey = ref(true)
let timer: ReturnType<typeof setInterval> | undefined

const running = computed(() => job.value?.status === 'running')
const percent = computed(() => (job.value ? Math.round((job.value.done / job.value.total) * 100) : 0))
// 每条大约 30-60 秒，给个粗略预估
const estimate = computed(() => `约 ${Math.max(1, Math.round(props.items.length * 0.75))} 分钟`)

async function refresh() {
  const r = await api.docs()
  job.value = r.job
  files.value = r.files
  if (job.value?.status !== 'running') stopPolling()
}

function startPolling() {
  stopPolling()
  timer = setInterval(refresh, 1500)
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = undefined
}

async function start() {
  error.value = ''
  try {
    job.value = await api.startDoc({ ids: props.items.map((f) => f.id), task: task.value, platform: platform.value })
    startPolling()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function cancel() {
  await api.cancelDoc()
  await refresh()
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`)
const fmtTime = (t: number) => new Date(t).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })

onMounted(async () => {
  hasKey.value = (await api.aiConfig()).hasKey
  await refresh()
  if (running.value) startPolling()
})
onUnmounted(stopPolling)
</script>

<template>
  <div class="drawer-mask center" @click.self="emit('close')">
    <section class="card dialog docs-dialog">
      <header class="card-head">
        <h3>生成 Word 文档</h3>
        <button class="icon" title="关闭" @click="emit('close')">✕</button>
      </header>

      <div class="dialog-body">
        <!-- 生成进度或上次的结果 -->
        <template v-if="job">
          <div v-if="running" class="progress-box">
            <div class="progress-line">
              <span>正在生成第 {{ Math.min(job.done + 1, job.total) }} / {{ job.total }} 篇</span>
              <span class="muted">{{ percent }}%</span>
            </div>
            <div class="progress" role="progressbar" :aria-valuenow="percent" aria-valuemin="0" aria-valuemax="100">
              <div class="progress-fill" :style="{ width: `${percent}%` }" />
            </div>
            <p class="muted current">{{ job.current }}</p>
            <p v-if="job.failed" class="error">已有 {{ job.failed }} 篇生成失败，文档里会标出原因</p>
            <p class="muted">可以关闭这个窗口，生成会在后台继续。</p>
          </div>
          <div v-else-if="job.status === 'done' && job.file" class="result ok">
            <div>
              <strong>✓ 文档已生成</strong>
              <span v-if="job.failed" class="muted">（{{ job.failed }} 篇失败，已在文档里标出）</span>
            </div>
            <a class="btn primary" :href="api.docUrl(job.file)" :download="job.file">下载 {{ job.file }}</a>
          </div>
          <p v-else-if="job.status === 'error'" class="error">生成失败：{{ job.error }}</p>
          <p v-else-if="job.status === 'cancelled'" class="muted">已取消，已生成的部分没有保存。</p>
        </template>

        <!-- 设置（从「历史文档」打开时没有选中素材，只显示历史） -->
        <template v-if="!running && items.length">
          <label class="field">
            <span>已选 {{ items.length }} 条素材</span>
            <ul class="picked">
              <li v-for="f in items" :key="f.id">{{ f.title }}</li>
            </ul>
          </label>
          <label class="field">
            <span>每条生成什么</span>
            <div class="history">
              <button class="chip" :class="{ on: task === 'analyze' }" @click="task = 'analyze'">选题分析</button>
              <button class="chip" :class="{ on: task === 'draft' }" @click="task = 'draft'">文案初稿</button>
            </div>
          </label>
          <label v-if="task === 'draft'" class="field">
            <span>平台风格</span>
            <div class="history">
              <button v-for="p in PLATFORMS" :key="p.id" class="chip" :class="{ on: platform === p.id }" @click="platform = p.id">
                {{ p.name }}
              </button>
            </div>
          </label>
          <p class="muted">
            AI 会逐条生成，会参考你在素材上写的笔记。每条素材单独一章，开头附上来源、链接、标签。预计{{ estimate }}。
          </p>
          <p v-if="!hasKey" class="error">
            还没有配置 AI。
            <button class="btn" @click="ai.settingsOpen = true">去设置</button>
          </p>
          <p v-if="error" class="error">{{ error }}</p>
        </template>

        <!-- 历史文档 -->
        <p v-if="!items.length && !files.length && !job" class="muted">还没有生成过文档。在素材库点「批量生成文档」，勾选素材后开始生成。</p>
        <div v-if="files.length" class="field">
          <span>已生成的文档</span>
          <ul class="doc-files">
            <li v-for="f in files" :key="f.file">
              <a :href="api.docUrl(f.file)" :download="f.file" class="row-title">📄 {{ f.file }}</a>
              <span class="muted">{{ fmtSize(f.size) }} · {{ fmtTime(f.createdAt) }}</span>
            </li>
          </ul>
        </div>
      </div>

      <footer class="drawer-foot">
        <button v-if="running" class="btn" @click="cancel">取消生成</button>
        <template v-else>
          <button class="btn" @click="emit('close')">关闭</button>
          <button v-if="items.length" class="btn primary" :disabled="!hasKey" @click="start">
            {{ job?.status === 'done' ? '再生成一份' : '开始生成' }}
          </button>
        </template>
      </footer>
    </section>
  </div>
</template>
