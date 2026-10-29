<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiTopic } from '../ai'
import { PUBLISH_PLATFORMS, type PlatformId } from '../api'
import { createTopic } from '../nav'
import { splitDraft, usePosts } from '../posts'
import { useTemplates } from '../templates'
import { useTones } from '../tones'
import PostEditor from './PostEditor.vue'
import TemplatePicker from './TemplatePicker.vue'
import TonePicker from './TonePicker.vue'

/**
 * 一页式创作：选题 → 结构、语气、平台 → 生成 → 编辑 + 手机预览 → 发布
 */
const posts = usePosts()
const toneStore = useTones()
const tplStore = useTemplates()

const topic = ref<AiTopic>({ title: '' })
const template = ref(tplStore.selected.value)
const customTemplate = ref(tplStore.custom.value)
const tones = ref<string[]>([...toneStore.selected.value])
const platforms = ref<PlatformId[]>(JSON.parse(localStorage.getItem('create-platforms') ?? '["wechat"]'))
const output = ref('')
const loading = ref(false)
const error = ref('')
const postId = ref<string | null>(null)
let controller: AbortController | null = null

// 写作风格按第一个平台来；头条、知乎用公众号的长文风格
const style = computed(() => (platforms.value[0] === 'xiaohongshu' ? 'xiaohongshu' : platforms.value[0] ?? 'wechat'))
const canGenerate = computed(() => topic.value.title.trim() && platforms.value.length && !(template.value === 'custom' && !customTemplate.value.trim()))

// 热榜、素材库点「写一篇」带过来的选题
watch(
  createTopic,
  (t) => {
    if (!t) return
    topic.value = { ...t }
    postId.value = null
    output.value = ''
    createTopic.value = null
  },
  { immediate: true },
)

function togglePlatform(id: PlatformId) {
  platforms.value = platforms.value.includes(id) ? platforms.value.filter((p) => p !== id) : [...platforms.value, id]
}

async function generate() {
  if (!canGenerate.value) return
  controller?.abort()
  controller = new AbortController()
  toneStore.save(tones.value)
  tplStore.save(template.value, customTemplate.value)
  localStorage.setItem('create-platforms', JSON.stringify(platforms.value))
  output.value = ''
  error.value = ''
  loading.value = true
  postId.value = null
  try {
    const res = await fetch('/api/ai/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'draft',
        topic: topic.value,
        platform: style.value,
        tones: tones.value,
        template: template.value,
        customTemplate: customTemplate.value,
      }),
      signal: controller.signal,
    })
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}))
      throw new Error(j.error ?? `请求失败 (${res.status})`)
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      output.value += decoder.decode(value, { stream: true })
    }
    // 生成完自动变成一篇文章，直接进入编辑 + 预览
    const { title, content } = splitDraft(output.value, topic.value.title)
    const post = await posts.add({
      title,
      content,
      platforms: platforms.value,
      source: topic.value.url ? { title: topic.value.title, url: topic.value.url } : undefined,
    })
    postId.value = post.id
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function stop() {
  controller?.abort()
}

function restart() {
  postId.value = null
  output.value = ''
}
</script>

<template>
  <section class="create">
    <!-- 第 1-3 步：设置 -->
    <div v-if="!postId" class="card create-setup">
      <div class="step">
        <span class="step-no">1</span>
        <div class="step-body">
          <h4>写什么</h4>
          <input v-model="topic.title" class="input big" placeholder="输入选题，或在热榜、素材库里点「写一篇」带过来" :disabled="loading" />
          <textarea
            v-model="topic.note"
            class="input"
            rows="2"
            placeholder="可选：你的想法、想强调的点、要用的素材（AI 会参考）"
            :disabled="loading"
          />
          <p v-if="topic.source" class="muted">来源：{{ topic.source }}</p>
        </div>
      </div>

      <div class="step">
        <span class="step-no">2</span>
        <div class="step-body">
          <h4>怎么写</h4>
          <TemplatePicker v-model="template" v-model:custom="customTemplate" :disabled="loading" />
          <TonePicker v-model="tones" :disabled="loading" />
          <div class="field">
            <span class="field-label">发到哪里（第一个平台决定写作风格，之后可以为其他平台单独改写）</span>
            <div class="history">
              <button
                v-for="p in PUBLISH_PLATFORMS"
                :key="p.id"
                class="chip"
                :class="{ on: platforms.includes(p.id) }"
                :disabled="loading"
                @click="togglePlatform(p.id)"
              >
                {{ platforms.indexOf(p.id) === 0 ? '★ ' : '' }}{{ p.name }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="step">
        <span class="step-no">3</span>
        <div class="step-body">
          <div class="draft-go">
            <span v-if="!topic.title.trim()" class="muted">先填写选题</span>
            <span v-else-if="!platforms.length" class="muted">至少选一个平台</span>
            <button v-if="loading" class="btn" @click="stop">停止</button>
            <button class="btn primary big-btn" :disabled="!canGenerate || loading" @click="generate">
              {{ loading ? 'AI 正在写…' : '✦ 生成文章' }}
            </button>
          </div>
          <p v-if="error" class="error">{{ error }}</p>
          <pre v-if="loading || output" class="stream-box">{{ output || 'AI 正在思考…' }}</pre>
        </div>
      </div>
    </div>

    <!-- 第 4-5 步：编辑 + 手机预览 + 发布 -->
    <template v-else>
      <div class="create-bar card">
        <span class="step-no done">✓</span>
        <span>
          <strong>{{ topic.title }}</strong>
          <span class="muted">已生成，可以在下面修改。修改会自动保存，右边是手机上的效果</span>
        </span>
        <span class="spacer" />
        <button class="btn" @click="restart">换个写法重新生成</button>
      </div>
      <PostEditor :key="postId" :post-id="postId" @deleted="restart" />
    </template>
  </section>
</template>
