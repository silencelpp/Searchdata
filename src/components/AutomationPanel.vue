<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, onMounted, ref } from 'vue'
import { useAlerts } from '../alerts'
import { api, type AutomationConfig, type AutomationStatus } from '../api'
import { useAi } from '../ai'
import { goCreate } from '../nav'

const emit = defineEmits<{ search: [q: string] }>()
const alerts = useAlerts()
const { state: ai } = useAi()

const config = ref<AutomationConfig | null>(null)
const status = ref<AutomationStatus | null>(null)
const keywordInput = ref('')
const saving = ref(false)
const saveMsg = ref('')
const error = ref('')
const snapping = ref(false)
const hasKey = ref(false)

const reports = ref<{ date: string; size: number }[]>([])
const reportDate = ref('')
const reportContent = ref('')
const generating = ref(false)
const reportError = ref('')

const INTERVALS = [5, 10, 15, 30, 60]

const reportHtml = computed(() => DOMPurify.sanitize(marked.parse(reportContent.value, { async: false })))
const fmt = (t: number) => (t ? new Date(t).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' }) : '还没有')

async function save() {
  if (!config.value) return
  saving.value = true
  error.value = ''
  try {
    const r = await api.saveAutomation(config.value)
    config.value = r.config
    status.value = r.status
    saveMsg.value = '已保存'
    setTimeout(() => (saveMsg.value = ''), 1500)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

function addKeywords() {
  if (!config.value) return
  const words = keywordInput.value.split(/[\s,，、]+/).filter(Boolean)
  config.value.monitor.keywords = [...new Set([...config.value.monitor.keywords, ...words])]
  keywordInput.value = ''
  save()
}

function removeKeyword(k: string) {
  if (!config.value) return
  config.value.monitor.keywords = config.value.monitor.keywords.filter((x) => x !== k)
  save()
}

async function snapshotNow() {
  snapping.value = true
  try {
    status.value = await api.snapshotNow()
    await alerts.refresh()
  } finally {
    snapping.value = false
  }
}

async function openReport(date: string) {
  reportDate.value = date
  reportError.value = ''
  try {
    reportContent.value = (await api.report(date)).content
  } catch (e) {
    reportError.value = (e as Error).message
  }
}

async function generateNow() {
  generating.value = true
  reportError.value = ''
  try {
    const r = await api.generateReport()
    reports.value = await api.reports()
    reportDate.value = r.date
    reportContent.value = r.content
  } catch (e) {
    reportError.value = (e as Error).message
  } finally {
    generating.value = false
  }
}

async function copyReport() {
  await navigator.clipboard.writeText(reportContent.value)
}

onMounted(async () => {
  const [a, r, c] = await Promise.all([api.automation(), api.reports(), api.aiConfig()])
  config.value = a.config
  status.value = a.status
  reports.value = r
  hasKey.value = c.hasKey
  if (r.length) openReport(r[0].date)
  alerts.markRead()
})
</script>

<template>
  <section v-if="config" class="auto">
    <div class="auto-grid">
      <!-- 关键词监控 -->
      <article class="card">
        <header class="card-head">
          <h3>关键词监控</h3>
          <label class="switch">
            <input v-model="config.monitor.enabled" type="checkbox" @change="save" />
            <span>{{ config.monitor.enabled ? '已开启' : '已关闭' }}</span>
          </label>
        </header>
        <div class="dialog-body">
          <p class="muted">每次记录热榜快照时，检查 6 个热榜的标题是否包含下面的关键词，命中就提醒你。</p>
          <form class="toolbar" @submit.prevent="addKeywords">
            <input v-model="keywordInput" class="input" placeholder="输入关键词，多个用空格分隔，例如：AI 新能源 华为" />
            <button class="btn primary" :disabled="!keywordInput.trim()">添加</button>
          </form>
          <div class="history">
            <span v-if="!config.monitor.keywords.length" class="muted">还没有关键词</span>
            <span v-for="k in config.monitor.keywords" :key="k" class="chip on">
              {{ k }}
              <button class="chip-x" :title="`删除 ${k}`" @click="removeKeyword(k)">✕</button>
            </span>
          </div>
          <label class="check">
            <input v-model="config.monitor.autoSave" type="checkbox" @change="save" />
            命中的话题自动存进素材库（带「监控」和关键词标签）
          </label>
          <label class="check">
            <input
              type="checkbox"
              :checked="alerts.notifyEnabled.value"
              :disabled="alerts.notifyEnabled.value"
              @change="alerts.enableNotify()"
            />
            {{ alerts.notifyEnabled.value ? '已开启桌面通知（页面开着时生效）' : '开启桌面通知' }}
          </label>
        </div>
      </article>

      <!-- 快照与日报设置 -->
      <article class="card">
        <header class="card-head">
          <h3>定时任务</h3>
          <span v-if="saveMsg" class="muted">{{ saveMsg }}</span>
        </header>
        <div class="dialog-body">
          <label class="field">
            <span>热榜快照间隔（用于飙升标记、走势图、关键词监控）</span>
            <div class="history">
              <button
                v-for="m in INTERVALS"
                :key="m"
                class="chip"
                :class="{ on: config.snapshot.intervalMin === m }"
                @click="config.snapshot.intervalMin = m; save()"
              >
                {{ m }} 分钟
              </button>
            </div>
          </label>
          <div class="status-line">
            <span class="muted">上次快照：{{ fmt(status?.lastSnapshotAt ?? 0) }} · 近 3 天共 {{ status?.snapshotCount ?? 0 }} 次</span>
            <button class="btn" :disabled="snapping" @click="snapshotNow">{{ snapping ? '记录中…' : '立即记录一次' }}</button>
          </div>
          <label class="check">
            <input v-model="config.daily.enabled" type="checkbox" @change="save" />
            每天
            <input v-model="config.daily.time" type="time" class="input time" @change="save" />
            自动生成 AI 选题日报
          </label>
          <p v-if="config.daily.enabled && !hasKey" class="error">
            还没有配置 AI，日报不会生成。
            <button class="btn" @click="ai.settingsOpen = true">去设置</button>
          </p>
          <p class="muted">
            定时任务只在网页后端（npm run dev 或 npm start）运行时执行。错过设定时间的话，后端启动后会补生成当天的日报。
          </p>
          <p v-if="status?.lastError" class="error">上次执行出错：{{ status.lastError }}</p>
          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </article>
    </div>

    <!-- 提醒记录 -->
    <article class="card">
      <header class="card-head">
        <h3>监控提醒</h3>
        <span class="muted">{{ alerts.list.value.length }} 条</span>
        <button v-if="alerts.list.value.length" class="btn" @click="alerts.clear()">清空</button>
      </header>
      <p v-if="!alerts.list.value.length" class="muted pad">
        还没有命中。添加关键词后，下次记录快照时会开始检查。
      </p>
      <ul v-else class="list alert-list">
        <li v-for="a in alerts.list.value" :key="a.id" class="row">
          <span class="chip on alert-kw">{{ a.keyword }}</span>
          <div class="row-body">
            <a :href="a.url" target="_blank" rel="noopener noreferrer" class="row-title">{{ a.title }}</a>
            <div class="row-meta">
              <span class="badge">{{ a.sourceName }}</span>
              <span>上榜时第 {{ a.rank }} 名</span>
              <span v-if="a.hot" class="hot">{{ a.hot }}</span>
              <span>{{ fmt(a.at) }}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="icon" title="AI 选题分析" @click="useAi().start('analyze', { title: a.title, source: a.sourceName })">✦</button>
            <button class="icon" title="写一篇：带着这个选题去创作" @click="goCreate({ title: a.title, source: a.sourceName, url: a.url })">✍</button>
            <button class="icon" title="全网搜索" @click="emit('search', a.title)">⌕</button>
          </div>
        </li>
      </ul>
    </article>

    <!-- 日报 -->
    <article class="card">
      <header class="card-head">
        <h3>选题日报</h3>
        <button class="btn primary" :disabled="generating || !hasKey" @click="generateNow">
          {{ generating ? 'AI 生成中…（约 1 分钟）' : '✦ 立即生成今天的日报' }}
        </button>
      </header>
      <div class="report">
        <nav class="report-dates">
          <p v-if="!reports.length" class="muted">还没有日报</p>
          <button
            v-for="r in reports"
            :key="r.date"
            :class="{ active: reportDate === r.date }"
            @click="openReport(r.date)"
          >
            {{ r.date }}
          </button>
        </nav>
        <div class="report-body">
          <p v-if="!hasKey" class="muted">
            生成日报需要先配置 AI。
            <button class="btn" @click="ai.settingsOpen = true">去设置</button>
          </p>
          <p v-if="reportError" class="error">{{ reportError }}</p>
          <template v-if="reportContent">
            <div class="report-actions">
              <button class="btn" @click="copyReport">复制 Markdown</button>
            </div>
            <!-- eslint-disable-next-line vue/no-v-html -- 内容已经过 DOMPurify 清洗 -->
            <article class="markdown" v-html="reportHtml" />
          </template>
        </div>
      </div>
    </article>
  </section>
  <p v-else class="muted pad">加载中…</p>
</template>
