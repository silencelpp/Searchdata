<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, ref } from 'vue'
import { api, type PlatformId } from '../api'
import { useTones } from '../tones'
import TonePicker from './TonePicker.vue'

const props = defineProps<{ postId: string; scope: 'main' | PlatformId; scopeName: string; title: string; dirty: boolean }>()
const emit = defineEmits<{ close: []; apply: [v: { title: string; content: string }] }>()

const toneStore = useTones()
const tones = ref<string[]>([...toneStore.selected.value])
const result = ref<{ title: string; content: string } | null>(null)
const loading = ref(false)
const error = ref('')
let abort: AbortController | null = null

const html = computed(() => (result.value ? DOMPurify.sanitize(marked.parse(result.value.content, { async: false })) : ''))

async function run() {
  if (!tones.value.length) return
  toneStore.save(tones.value)
  loading.value = true
  error.value = ''
  result.value = null
  abort = new AbortController()
  try {
    result.value = await api.restyle(props.postId, props.scope, tones.value, abort.signal)
  } catch (e) {
    if ((e as Error).name !== 'AbortError') error.value = (e as Error).message
  } finally {
    loading.value = false
  }
}

function close() {
  abort?.abort()
  emit('close')
}
</script>

<template>
  <div class="drawer-mask center" @click.self="close">
    <section class="card dialog restyle-dialog">
      <header class="card-head">
        <h3>风格优化 · {{ scopeName }}</h3>
        <button class="icon" title="关闭" @click="close">✕</button>
      </header>
      <div class="dialog-body">
        <p class="muted">
          选好文章类型，AI 会保留原文的观点和事实，只调整语气、用词、开头和结尾。优化结果先在这里预览，点「采用」才会替换正文。
        </p>
        <p v-if="dirty" class="warn">⚠ 你有未保存的修改，AI 会基于已保存的内容优化。建议先关掉这个窗口点「保存」。</p>
        <TonePicker v-model="tones" :disabled="loading" />
        <div class="draft-go">
          <button class="btn primary" :disabled="loading || !tones.length" @click="run">
            {{ loading ? 'AI 优化中…（约 1 分钟）' : result ? '✦ 按新类型重新优化' : '✦ 开始优化' }}
          </button>
        </div>
        <p v-if="error" class="error">{{ error }}</p>

        <div v-if="result" class="restyle-result">
          <div class="field">
            <span>优化后的标题</span>
            <div class="restyle-title">
              <del v-if="result.title !== title">{{ title }}</del>
              <strong>{{ result.title }}</strong>
            </div>
          </div>
          <div class="field">
            <span>优化后的正文</span>
            <!-- eslint-disable-next-line vue/no-v-html -- 内容已经过 DOMPurify 清洗 -->
            <article class="markdown preview-box" v-html="html" />
          </div>
        </div>
      </div>
      <footer class="drawer-foot">
        <span class="muted">采用后文章会退回「待审核」，记得再检查一遍</span>
        <button class="btn" @click="close">取消</button>
        <button v-if="result" class="btn primary" @click="emit('apply', { title: result.title, content: result.content })">采用</button>
      </footer>
    </section>
  </div>
</template>
