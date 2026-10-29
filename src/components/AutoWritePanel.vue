<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useAi } from '../ai'
import { api, PUBLISH_PLATFORMS, type AutoJob, type PlatformId } from '../api'
import { goPublish } from '../nav'
import { usePosts } from '../posts'
import { useTones } from '../tones'
import TonePicker from './TonePicker.vue'

/** 一键生成：填题材 → 点按钮 → 自动找热点、写文章 */
const { state: ai } = useAi()
const posts = usePosts()
const toneStore = useTones()

const saved = JSON.parse(localStorage.getItem('auto-write') ?? '{}') as { theme?: string; count?: number; platforms?: PlatformId[] }
const theme = ref(saved.theme ?? '')
const count = ref(saved.count ?? 3)
const platforms = ref<PlatformId[]>(saved.platforms?.length ? saved.platforms : ['wechat'])
const tones = ref<string[]>([...toneStore.selected.value])
const showMore = ref(false)
const job = ref<AutoJob | null>(null)
const error = ref('')
const hasKey = ref(true)
let timer: ReturnType<typeof setInterval> | undefined

const SUGGEST = ['科技数码', '职场', '情感', '财经', '美食', '育儿', '健康', '本地生活']
const running = computed(() => !!job.value && ['scanning', 'picking', 'writing'].includes(job.value.stage))
const doneCount = computed(() => job.value?.articles.filter((a) => a.status === 'done').length ?? 0)
const percent = computed(() => {
  const j = job.value
  if (!j) return 0
  if (j.stage === 'scanning') return 5
  if (j.stage === 'picking') return 15
  const total = j.articles.length || 1
  const finished = j.articles.filter((a) => a.status === 'done' || a.status === 'error').length
  return Math.round(15 + (finished / total) * 85)
})

function togglePlatform(id: PlatformId) {
  platforms.value = platforms.value.includes(id) ? platforms.value.filter((p) => p !== id) : [...platforms.value, id]
}

async function poll() {
  job.value = await api.autoJob().catch(() => job.value)
  if (!running.value) {
    stopPolling()
    await posts.refresh()
  }
}

function startPolling() {
  stopPolling()
  timer = setInterval(poll, 1500)
}

function stopPolling() {
  if (timer) clearInterval(timer)
  timer = undefined
}

async function go() {
  error.value = ''
  localStorage.setItem('auto-write', JSON.stringify({ theme: theme.value, count: count.value, platforms: platforms.value }))
  toneStore.save(tones.value)
  try {
    job.value = await api.startAuto({ theme: theme.value, count: count.value, platforms: platforms.value, tones: tones.value })
    startPolling()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function stop() {
  await api.cancelAuto()
  await poll()
}

onMounted(async () => {
  hasKey.value = (await api.aiConfig()).hasKey
  job.value = await api.autoJob().catch(() => null)
  if (running.value) startPolling()
})
onUnmounted(stopPolling)
</script>

<template>
  <section class="auto-write">
    <div class="card auto-hero">
      <h2>今天写点什么？</h2>
      <p class="muted">填一个你的账号方向，软件会自动去 6 个平台的热榜里找相关热点，挑好角度，把文章写好。</p>

      <div class="auto-form">
        <input
          v-model="theme"
          class="input big"
          maxlength="50"
          placeholder="题材，例如：科技数码、职场、情感……不填就挑今天最火的"
          :disabled="running"
          @keydown.enter="!running && hasKey && platforms.length && go()"
        />
        <div class="history">
          <button v-for="s in SUGGEST" :key="s" class="chip" :class="{ on: theme === s }" :disabled="running" @click="theme = s">{{ s }}</button>
        </div>

        <div class="auto-row">
          <span class="field-label">写几篇</span>
          <div class="history">
            <button v-for="n in [1, 3, 5]" :key="n" class="chip" :class="{ on: count === n }" :disabled="running" @click="count = n">{{ n }} 篇</button>
          </div>
          <span class="field-label">发到</span>
          <div class="history">
            <button
              v-for="p in PUBLISH_PLATFORMS"
              :key="p.id"
              class="chip"
              :class="{ on: platforms.includes(p.id) }"
              :disabled="running"
              @click="togglePlatform(p.id)"
            >
              {{ p.name }}
            </button>
          </div>
        </div>

        <button class="link more-toggle" :disabled="running" @click="showMore = !showMore">
          {{ showMore ? '收起' : '语气设置（可选）' }}{{ tones.length && !showMore ? `：${tones.join('、')}` : '' }}
        </button>
        <TonePicker v-if="showMore" v-model="tones" :disabled="running" />

        <p v-if="!hasKey" class="error">
          还没有配置 AI。
          <button class="btn" @click="ai.settingsOpen = true">去设置</button>
        </p>
        <p v-if="error" class="error">{{ error }}</p>

        <div class="auto-go">
          <button v-if="running" class="btn" @click="stop">停止</button>
          <button class="btn primary go-btn" :disabled="running || !hasKey || !platforms.length" @click="go">
            {{ running ? '生成中…' : `✦ 一键生成 ${count} 篇` }}
          </button>
        </div>
      </div>
    </div>

    <!-- 进度和结果 -->
    <div v-if="job" class="card auto-result">
      <header class="card-head">
        <h3>{{ job.theme ? `「${job.theme}」` : '今日热点' }}</h3>
        <span class="muted">{{ job.message }}</span>
      </header>
      <div v-if="running" class="progress-wrap">
        <div class="progress"><div class="progress-fill" :style="{ width: `${percent}%` }" /></div>
        <p class="muted">每篇大约 30 秒到 1 分钟，可以去做别的，写好的文章会自动出现在「我的文章」。</p>
      </div>
      <p v-if="job.stage === 'error'" class="error">{{ job.error }}</p>

      <ul class="list auto-list">
        <li v-for="(a, i) in job.articles" :key="i" class="row">
          <span class="auto-status" :class="a.status">
            {{ a.status === 'done' ? '✓' : a.status === 'error' ? '✕' : a.status === 'writing' ? '…' : i + 1 }}
          </span>
          <div class="row-body">
            <div class="row-title">{{ a.title || a.topic }}</div>
            <div class="row-meta">
              <span class="badge">{{ a.source }}</span>
              <span v-if="a.title && a.title !== a.topic">热点：{{ a.topic }}</span>
            </div>
            <p class="row-desc">角度：{{ a.angle }}</p>
            <p v-if="a.error" class="warn">生成失败：{{ a.error }}</p>
          </div>
          <button v-if="a.postId" class="btn primary" @click="goPublish(a.postId)">查看 / 发布</button>
          <span v-else-if="a.status === 'writing'" class="muted">正在写…</span>
          <span v-else-if="a.status === 'waiting'" class="muted">排队中</span>
        </li>
      </ul>

      <footer v-if="!running && doneCount" class="drawer-foot">
        <span class="muted">文章还没有发出去，点「查看 / 发布」检查后再发</span>
        <button class="btn" @click="goPublish(job.articles.find((a) => a.postId)!.postId!)">去「我的文章」看全部</button>
      </footer>
    </div>
  </section>
</template>
