<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api, PUBLISH_PLATFORMS, type PlatformId, type Post } from '../api'
import { usePosts } from '../posts'

const { list, refresh, add, replace, settingsOpen } = usePosts()

const filter = ref<'all' | 'pending' | 'approved'>('all')
const activeId = ref<string | null>(null)
const draft = reactive({ title: '', content: '', summary: '', tags: '' })
const preview = ref(false)
const saving = ref(false)
const dirty = ref(false)
const error = ref('')
const uploading = ref(false)
let poll: ReturnType<typeof setInterval> | undefined

const filtered = computed(() => list.value.filter((p) => filter.value === 'all' || p.status === filter.value))
const active = computed(() => list.value.find((p) => p.id === activeId.value) ?? null)
const html = computed(() => DOMPurify.sanitize(marked.parse(draft.content, { async: false })))
const anyRunning = computed(() => list.value.some((p) => Object.values(p.results).some((r) => r?.status === 'running')))

// 各平台标题字数上限，超过时提示
const LIMITS: Partial<Record<PlatformId, number>> = { wechat: 64, xiaohongshu: 20, toutiao: 30, zhihu: 100 }
const titleWarnings = computed(() =>
  (active.value?.platforms ?? [])
    .filter((p) => LIMITS[p] && draft.title.length > LIMITS[p]!)
    .map((p) => `${PUBLISH_PLATFORMS.find((x) => x.id === p)!.name}标题最多 ${LIMITS[p]} 字`),
)

function open(p: Post) {
  if (dirty.value && !confirm('当前文章有未保存的修改，确定切换吗？')) return
  activeId.value = p.id
  draft.title = p.title
  draft.content = p.content
  draft.summary = p.summary
  draft.tags = p.tags.join(' ')
  error.value = ''
  // 等 watch 处理完这次赋值后再清掉「有修改」标记
  queueMicrotask(() => (dirty.value = false))
}

watch(draft, () => (dirty.value = true), { deep: true })

const tagList = () => draft.tags.split(/[\s,，#]+/).filter(Boolean)

async function save() {
  if (!active.value) return
  saving.value = true
  error.value = ''
  try {
    replace(await api.updatePost(active.value.id, { title: draft.title, content: draft.content, summary: draft.summary, tags: tagList() }))
    dirty.value = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/** 审核通过时把未保存的修改一起提交，免得「保存」把状态又改回待审核 */
async function approve(ok: boolean) {
  if (!active.value) return
  const patch: Partial<Post> = { status: ok ? 'approved' : 'pending' }
  if (dirty.value) Object.assign(patch, { title: draft.title, content: draft.content, summary: draft.summary, tags: tagList() })
  replace(await api.updatePost(active.value.id, patch))
  dirty.value = false
}

async function togglePlatform(id: PlatformId) {
  if (!active.value) return
  const has = active.value.platforms.includes(id)
  const platforms = has ? active.value.platforms.filter((x) => x !== id) : [...active.value.platforms, id]
  // 只改平台不需要重新审核：直接发送 platforms 字段
  replace(await api.updatePost(active.value.id, { platforms }))
}

async function onCover(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f || !active.value) return
  uploading.value = true
  error.value = ''
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(new Error('读取图片失败'))
      r.readAsDataURL(f)
    })
    const { name } = await api.upload(dataUrl)
    replace(await api.updatePost(active.value.id, { cover: name }))
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function removeCover() {
  if (active.value) replace(await api.updatePost(active.value.id, { cover: '' }))
}

async function doPublish() {
  if (!active.value) return
  error.value = ''
  try {
    replace(await api.publish(active.value.id, active.value.platforms))
    startPolling()
  } catch (e) {
    error.value = (e as Error).message
  }
}

async function newPost() {
  const p = await add({ title: '新文章', content: '' })
  filter.value = 'all'
  open(p)
}

async function del() {
  if (!active.value || !confirm(`删除「${active.value.title}」？`)) return
  await api.removePost(active.value.id)
  list.value = list.value.filter((p) => p.id !== active.value!.id)
  activeId.value = null
  dirty.value = false
}

function startPolling() {
  if (poll) return
  poll = setInterval(async () => {
    await refresh()
    if (!anyRunning.value) {
      clearInterval(poll)
      poll = undefined
    }
  }, 1500)
}

const STATUS_TEXT = { running: '进行中', filled: '已填好，待你发布', drafted: '已进草稿箱', error: '失败' }
const fmt = (t: number) => new Date(t).toLocaleString('zh-CN', { dateStyle: 'short', timeStyle: 'short' })

onMounted(async () => {
  await refresh()
  if (list.value[0]) open(list.value[0])
  if (anyRunning.value) startPolling()
})
onUnmounted(() => poll && clearInterval(poll))
</script>

<template>
  <section class="publish">
    <aside class="card post-list">
      <header class="card-head">
        <h3>待发布</h3>
        <button class="btn" @click="newPost">＋ 新建</button>
      </header>
      <div class="subtabs pad-x">
        <button :class="{ active: filter === 'all' }" @click="filter = 'all'">全部</button>
        <button :class="{ active: filter === 'pending' }" @click="filter = 'pending'">待审核</button>
        <button :class="{ active: filter === 'approved' }" @click="filter = 'approved'">已通过</button>
      </div>
      <p v-if="!filtered.length" class="muted pad">
        还没有文章。在 AI 助手里生成初稿后点「加入待发布」，或者点上面的「新建」。
      </p>
      <ul class="list">
        <li v-for="p in filtered" :key="p.id" class="post-item" :class="{ on: p.id === activeId }" @click="open(p)">
          <div class="row-title">{{ p.title }}</div>
          <div class="row-meta">
            <span class="state" :class="p.status">{{ p.status === 'approved' ? '已通过' : '待审核' }}</span>
            <span>{{ fmt(p.updatedAt) }}</span>
            <span v-for="(r, k) in p.results" :key="k" :class="['dot', r?.status]" :title="`${PUBLISH_PLATFORMS.find((x) => x.id === k)?.name}：${r ? STATUS_TEXT[r.status] : ''}`" />
          </div>
        </li>
      </ul>
    </aside>

    <div v-if="active" class="card post-editor">
      <header class="card-head">
        <span class="state" :class="active.status">{{ active.status === 'approved' ? '已审核通过' : '待审核' }}</span>
        <span v-if="dirty" class="muted">有未保存的修改</span>
        <span class="spacer" />
        <button class="btn" :class="{ on: preview }" @click="preview = !preview">{{ preview ? '编辑' : '预览' }}</button>
        <button class="btn" :disabled="saving || !dirty" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        <button class="icon" title="删除" @click="del">🗑</button>
      </header>

      <div class="dialog-body">
        <input v-model="draft.title" class="input big" placeholder="标题" />
        <p v-for="w in titleWarnings" :key="w" class="warn">⚠ {{ w }}，当前 {{ draft.title.length }} 字</p>
        <article v-if="preview" class="markdown preview-box" v-html="html" />
        <textarea v-else v-model="draft.content" class="input content-box" placeholder="正文，支持 Markdown" />
        <div class="two-col">
          <label class="field">
            <span>摘要（公众号用，最多 120 字）</span>
            <input v-model="draft.summary" class="input" maxlength="120" />
          </label>
          <label class="field">
            <span>标签 / 话题（空格分隔）</span>
            <input v-model="draft.tags" class="input" placeholder="例如：科技 AI 数码" />
          </label>
        </div>
        <div class="field">
          <span>封面图（公众号必填，小红书作为笔记图片）</span>
          <div class="cover-row">
            <img v-if="active.cover" :src="api.uploadUrl(active.cover)" class="cover" alt="封面" />
            <label class="btn">
              {{ uploading ? '上传中…' : active.cover ? '更换封面' : '上传封面' }}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onCover" />
            </label>
            <button v-if="active.cover" class="link" @click="removeCover">移除</button>
          </div>
        </div>
        <p v-if="active.source" class="muted">选题来源：<a :href="active.source.url" target="_blank" rel="noopener noreferrer" class="tag">{{ active.source.title }}</a></p>
      </div>

      <section class="publish-box">
        <div class="publish-head">
          <h4>发布到</h4>
          <button class="link" @click="settingsOpen = true">⚙ 发布设置</button>
        </div>
        <div class="platforms">
          <label v-for="p in PUBLISH_PLATFORMS" :key="p.id" class="platform" :class="{ on: active.platforms.includes(p.id) }">
            <input type="checkbox" :checked="active.platforms.includes(p.id)" @change="togglePlatform(p.id)" />
            <span>
              <strong>{{ p.name }}</strong>
              <span class="muted">{{ p.how }}</span>
            </span>
            <span v-if="active.results[p.id]" :class="['result-tag', active.results[p.id]!.status]">
              {{ STATUS_TEXT[active.results[p.id]!.status] }}
            </span>
          </label>
        </div>
        <ul v-if="Object.keys(active.results).length" class="results">
          <li v-for="(r, k) in active.results" :key="k" :class="r?.status">
            <strong>{{ PUBLISH_PLATFORMS.find((x) => x.id === k)?.name }}：</strong>{{ r?.message }}
          </li>
        </ul>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="publish-actions">
          <span class="muted">软件只会推到草稿箱或填好内容，最终的「发布」需要你在平台上亲手点。</span>
          <template v-if="active.status === 'pending'">
            <button class="btn primary" :disabled="!draft.title.trim() || !draft.content.trim()" @click="approve(true)">✓ 审核通过</button>
          </template>
          <template v-else>
            <button class="btn" @click="approve(false)">撤回审核</button>
            <button class="btn primary" :disabled="!active.platforms.length || dirty" :title="dirty ? '请先保存修改' : ''" @click="doPublish">
              🚀 发布到 {{ active.platforms.length }} 个平台
            </button>
          </template>
        </div>
      </section>
    </div>
    <div v-else class="card post-editor empty-editor">
      <p class="muted">在左边选一篇文章开始审核</p>
    </div>
  </section>
</template>
