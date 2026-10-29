<script setup lang="ts">
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { api, PUBLISH_PLATFORMS, type Issue, type PlatformId, type Post, type Suggestion } from '../api'
import { usePosts } from '../posts'
import CoverMaker from './CoverMaker.vue'
import RestyleDialog from './RestyleDialog.vue'

const { list, refresh, add, replace, settingsOpen } = usePosts()

type Scope = 'main' | PlatformId

const filter = ref<'all' | 'pending' | 'approved'>('all')
const activeId = ref<string | null>(null)
/** 正在编辑哪个版本：通用版本，或者某个平台的专属版本 */
const scope = ref<Scope>('main')
const draft = reactive({ title: '', content: '', summary: '', tags: '' })
const preview = ref(false)
const saving = ref(false)
const dirty = ref(false)
const error = ref('')
const uploading = ref(false)
const issues = ref<Issue[]>([])
const suggestions = ref<Suggestion[] | null>(null)
const proofreading = ref(false)
const rewriting = ref<PlatformId | null>(null)
const coverMaker = ref(false)
const restyleOpen = ref(false)
let poll: ReturnType<typeof setInterval> | undefined

const name = (id: Scope) => (id === 'main' ? '通用版本' : PUBLISH_PLATFORMS.find((x) => x.id === id)!.name)
const filtered = computed(() => list.value.filter((p) => filter.value === 'all' || p.status === filter.value))
const active = computed(() => list.value.find((p) => p.id === activeId.value) ?? null)
const variant = computed(() => (scope.value === 'main' ? null : active.value?.variants?.[scope.value] ?? null))
/** 当前选中的平台标签页还没有专属版本，用的是通用版本 */
const usingMain = computed(() => scope.value !== 'main' && !variant.value)
const cover = computed(() => (scope.value === 'main' ? active.value?.cover : variant.value?.cover))
const html = computed(() => DOMPurify.sanitize(marked.parse(draft.content, { async: false })))
const anyRunning = computed(() => list.value.some((p) => Object.values(p.results).some((r) => r?.status === 'running')))
const errors = computed(() => issues.value.filter((i) => i.level === 'error'))
const warns = computed(() => issues.value.filter((i) => i.level === 'warn'))
const issuesHere = computed(() => issues.value.filter((i) => i.scope === scope.value).length)

function load() {
  const p = active.value
  if (!p) return
  const v = scope.value === 'main' ? null : p.variants?.[scope.value]
  draft.title = v?.title ?? p.title
  draft.content = v?.content ?? p.content
  draft.summary = p.summary
  draft.tags = (v?.tags.length ? v.tags : p.tags).join(' ')
  suggestions.value = null
  // 等 watch 处理完这次赋值后再清掉「有修改」标记
  queueMicrotask(() => (dirty.value = false))
}

async function check() {
  if (active.value) issues.value = await api.checkPost(active.value.id).catch(() => [])
}

async function open(p: Post) {
  if (dirty.value && !confirm('当前文章有未保存的修改，确定切换吗？')) return
  activeId.value = p.id
  scope.value = 'main'
  error.value = ''
  load()
  await check()
}

/** 切换版本前自动保存，免得改了一半的内容丢掉 */
async function switchScope(s: Scope) {
  if (s === scope.value) return
  if (dirty.value && !usingMain.value) await save()
  scope.value = s
  load()
}

watch(draft, () => (dirty.value = true), { deep: true })

const tagList = () => draft.tags.split(/[\s,，#]+/).filter(Boolean)

function patchFor(): Partial<Post> {
  if (scope.value === 'main') return { title: draft.title, content: draft.content, summary: draft.summary, tags: tagList() }
  return { variants: { [scope.value]: { title: draft.title, content: draft.content, tags: tagList(), cover: variant.value?.cover } } }
}

async function save() {
  if (!active.value || usingMain.value) return
  saving.value = true
  error.value = ''
  try {
    replace(await api.updatePost(active.value.id, patchFor()))
    dirty.value = false
    await check()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

/** 审核通过时把未保存的修改一起提交；后端会再跑一遍发布前检查 */
async function approve(ok: boolean) {
  if (!active.value) return
  error.value = ''
  try {
    if (dirty.value && !usingMain.value) {
      replace(await api.updatePost(active.value.id, patchFor()))
      dirty.value = false
    }
    replace(await api.updatePost(active.value.id, { status: ok ? 'approved' : 'pending' }))
  } catch (e) {
    error.value = (e as Error).message
  }
  await check()
}

async function togglePlatform(id: PlatformId) {
  if (!active.value) return
  const has = active.value.platforms.includes(id)
  const platforms = has ? active.value.platforms.filter((x) => x !== id) : [...active.value.platforms, id]
  // 只改平台不需要重新审核
  replace(await api.updatePost(active.value.id, { platforms }))
  if (has && scope.value === id) {
    scope.value = 'main'
    load()
  }
  await check()
}

// ---------- 平台专属版本 ----------

async function rewrite(p: PlatformId) {
  if (!active.value) return
  if (dirty.value) await save()
  rewriting.value = p
  error.value = ''
  try {
    replace(await api.rewrite(active.value.id, p))
    scope.value = p
    load()
    await check()
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    rewriting.value = null
  }
}

/** 不用 AI，直接复制一份通用版本再手动改 */
async function copyMain(p: PlatformId) {
  if (!active.value) return
  const m = active.value
  replace(await api.updatePost(m.id, { variants: { [p]: { title: m.title, content: m.content, tags: m.tags } } }))
  load()
  await check()
}

async function dropVariant() {
  if (!active.value || scope.value === 'main' || !confirm(`删除${name(scope.value)}专属版本，改回使用通用版本？`)) return
  replace(await api.updatePost(active.value.id, { variants: { [scope.value]: null } as any }))
  load()
  await check()
}

// ---------- 封面 ----------

async function setCover(file: string) {
  if (!active.value) return
  if (scope.value === 'main') replace(await api.updatePost(active.value.id, { cover: file }))
  else {
    const v = variant.value!
    replace(await api.updatePost(active.value.id, { variants: { [scope.value]: { ...v, title: draft.title, content: draft.content, tags: tagList(), cover: file } } }))
    dirty.value = false
  }
  await check()
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
    await setCover((await api.upload(dataUrl)).name)
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    uploading.value = false
    ;(e.target as HTMLInputElement).value = ''
  }
}

async function onCoverMade(file: string) {
  coverMaker.value = false
  await setCover(file)
}

const coverSize = computed(() => (scope.value === 'xiaohongshu' ? 'xiaohongshu' : 'wechat'))

// ---------- AI 校对 ----------

async function runProofread() {
  if (!active.value) return
  if (dirty.value) await save()
  proofreading.value = true
  error.value = ''
  try {
    suggestions.value = await api.proofread(active.value.id, scope.value)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    proofreading.value = false
  }
}

function accept(s: Suggestion) {
  if (draft.title.includes(s.find)) draft.title = draft.title.replace(s.find, s.replace)
  else if (draft.content.includes(s.find)) draft.content = draft.content.replace(s.find, s.replace)
  suggestions.value = suggestions.value!.filter((x) => x !== s)
}

function acceptAll() {
  for (const s of [...(suggestions.value ?? [])]) accept(s)
}

const KIND = { typo: '错别字', grammar: '病句', fact: '需核实', style: '表达' }

// ---------- 风格优化 ----------

/** 采用 AI 优化结果：替换标题和正文并直接保存（文章会退回待审核） */
async function applyRestyle(v: { title: string; content: string }) {
  restyleOpen.value = false
  draft.title = v.title
  draft.content = v.content
  await save()
}

// ---------- 发布 ----------

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
  await open(p)
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
  if (list.value[0]) await open(list.value[0])
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
            <span v-for="(r, k) in p.results" :key="k" :class="['dot', r?.status]" :title="`${name(k)}：${r ? STATUS_TEXT[r.status] : ''}`" />
          </div>
        </li>
      </ul>
    </aside>

    <div v-if="active" class="card post-editor">
      <header class="card-head">
        <span class="state" :class="active.status">{{ active.status === 'approved' ? '已审核通过' : '待审核' }}</span>
        <span v-if="dirty" class="muted">有未保存的修改</span>
        <span class="spacer" />
        <button v-if="!usingMain" class="btn" @click="restyleOpen = true">✦ 风格优化</button>
        <button v-if="!usingMain" class="btn" :disabled="proofreading" @click="runProofread">
          {{ proofreading ? 'AI 校对中…' : '✦ AI 校对' }}
        </button>
        <button v-if="!usingMain" class="btn" :class="{ on: preview }" @click="preview = !preview">{{ preview ? '编辑' : '预览' }}</button>
        <button v-if="!usingMain" class="btn" :disabled="saving || !dirty" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
        <button class="icon" title="删除文章" @click="del">🗑</button>
      </header>

      <!-- 版本切换：通用版本 + 每个选中平台 -->
      <nav class="version-tabs">
        <button :class="{ active: scope === 'main' }" @click="switchScope('main')">
          通用版本
          <span v-if="issues.some((i) => i.scope === 'main' && i.level === 'error')" class="tab-dot error" />
        </button>
        <button v-for="p in active.platforms" :key="p" :class="{ active: scope === p }" @click="switchScope(p)">
          {{ name(p) }}
          <span class="muted">{{ active.variants?.[p] ? '专属' : '同通用' }}</span>
          <span v-if="issues.some((i) => i.scope === p && i.level === 'error')" class="tab-dot error" />
        </button>
      </nav>

      <!-- 平台标签页但还没有专属版本 -->
      <div v-if="usingMain" class="dialog-body variant-empty">
        <p>{{ name(scope) }}现在直接发通用版本。不同平台的读者习惯不一样，建议单独做一个版本。</p>
        <div class="editor-actions start">
          <button class="btn primary" :disabled="!!rewriting" @click="rewrite(scope as PlatformId)">
            {{ rewriting === scope ? `AI 正在改写成${name(scope)}版本…（约 1 分钟）` : `✦ AI 改写成${name(scope)}版本` }}
          </button>
          <button class="btn" :disabled="!!rewriting" @click="copyMain(scope as PlatformId)">复制通用版本，手动修改</button>
        </div>
      </div>

      <div v-else class="dialog-body">
        <div v-if="scope !== 'main'" class="variant-bar">
          <span class="muted">这是{{ name(scope) }}专属版本，只会发到{{ name(scope) }}</span>
          <button class="link" :disabled="!!rewriting" @click="rewrite(scope as PlatformId)">
            {{ rewriting === scope ? '改写中…' : '用 AI 重新改写' }}
          </button>
          <button class="link" @click="dropVariant">删除专属版本</button>
        </div>
        <input v-model="draft.title" class="input big" placeholder="标题" />

        <!-- AI 校对结果 -->
        <div v-if="suggestions" class="suggest-box">
          <div class="suggest-head">
            <strong>AI 校对建议</strong>
            <span class="muted">{{ suggestions.length ? `${suggestions.length} 条` : '没有发现问题' }}</span>
            <span class="spacer" />
            <button v-if="suggestions.length" class="link" @click="acceptAll">全部采用</button>
            <button class="link" @click="suggestions = null">收起</button>
          </div>
          <ul v-if="suggestions.length" class="suggest-list">
            <li v-for="(s, i) in suggestions" :key="i">
              <span class="kind" :class="s.kind">{{ KIND[s.kind] }}</span>
              <div class="suggest-body">
                <div><del>{{ s.find }}</del> → <ins>{{ s.replace }}</ins></div>
                <div class="muted">{{ s.reason }}</div>
              </div>
              <button class="btn" @click="accept(s)">采用</button>
              <button class="link" @click="suggestions = suggestions!.filter((x) => x !== s)">忽略</button>
            </li>
          </ul>
        </div>

        <article v-if="preview" class="markdown preview-box" v-html="html" />
        <textarea v-else v-model="draft.content" class="input content-box" placeholder="正文，支持 Markdown" />
        <div class="two-col">
          <label v-if="scope === 'main'" class="field">
            <span>摘要（公众号用，最多 120 字）</span>
            <input v-model="draft.summary" class="input" maxlength="120" />
          </label>
          <label class="field">
            <span>{{ scope === 'xiaohongshu' ? '话题（空格分隔，会加在正文末尾）' : '标签 / 话题（空格分隔）' }}</span>
            <input v-model="draft.tags" class="input" placeholder="例如：科技 AI 数码" />
          </label>
        </div>
        <div class="field">
          <span>
            封面图
            <template v-if="scope === 'main'">（公众号必填，小红书作为笔记图片）</template>
            <template v-else-if="!cover">（没有单独设置，使用通用版本的封面）</template>
          </span>
          <div class="cover-row">
            <img v-if="cover || active.cover" :src="api.uploadUrl((cover || active.cover)!)" class="cover" :class="{ faded: !cover }" alt="封面" />
            <button class="btn primary" @click="coverMaker = true">✦ 生成封面</button>
            <label class="btn">
              {{ uploading ? '上传中…' : '上传图片' }}
              <input type="file" accept="image/png,image/jpeg,image/webp" hidden @change="onCover" />
            </label>
            <button v-if="cover" class="link" @click="setCover('')">移除</button>
          </div>
        </div>
        <p v-if="active.source" class="muted">选题来源：<a :href="active.source.url" target="_blank" rel="noopener noreferrer" class="tag">{{ active.source.title }}</a></p>
      </div>

      <!-- 发布前检查 -->
      <section class="check-box" :class="{ ok: !issues.length }">
        <div class="publish-head">
          <h4>发布前检查</h4>
          <span v-if="!issues.length" class="ok-text">✓ 没有发现问题</span>
          <span v-else class="muted">{{ errors.length }} 个必须修改 · {{ warns.length }} 个提醒{{ issuesHere ? '' : '（当前版本没有问题）' }}</span>
        </div>
        <ul v-if="issues.length" class="issue-list">
          <li v-for="(i, n) in [...errors, ...warns]" :key="n" :class="i.level">
            <span class="issue-icon">{{ i.level === 'error' ? '✕' : '!' }}</span>
            <button class="link scope-link" @click="switchScope(i.scope)">{{ name(i.scope) }}</button>
            <span>{{ i.message }}</span>
          </li>
        </ul>
      </section>

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
              <span class="muted">{{ p.how }}{{ active.variants?.[p.id] ? ' · 专属版本' : '' }}</span>
            </span>
            <span v-if="active.results[p.id]" :class="['result-tag', active.results[p.id]!.status]">
              {{ STATUS_TEXT[active.results[p.id]!.status] }}
            </span>
          </label>
        </div>
        <ul v-if="Object.keys(active.results).length" class="results">
          <li v-for="(r, k) in active.results" :key="k" :class="r?.status">
            <strong>{{ name(k) }}：</strong>{{ r?.message }}
          </li>
        </ul>
        <p v-if="error" class="error">{{ error }}</p>
        <div class="publish-actions">
          <span class="muted">软件只会推到草稿箱或填好内容，最终的「发布」需要你在平台上亲手点。</span>
          <template v-if="active.status === 'pending'">
            <button
              class="btn primary"
              :disabled="errors.length > 0"
              :title="errors.length ? '先解决发布前检查里必须修改的问题' : ''"
              @click="approve(true)"
            >
              ✓ 审核通过
            </button>
          </template>
          <template v-else>
            <button class="btn" @click="approve(false)">撤回审核</button>
            <button class="btn primary" :disabled="!active.platforms.length || dirty || errors.length > 0" :title="dirty ? '请先保存修改' : ''" @click="doPublish">
              🚀 发布到 {{ active.platforms.length }} 个平台
            </button>
          </template>
        </div>
      </section>
    </div>
    <div v-else class="card post-editor empty-editor">
      <p class="muted">在左边选一篇文章开始审核</p>
    </div>

    <CoverMaker v-if="coverMaker" :title="draft.title" :size="coverSize" @close="coverMaker = false" @done="onCoverMade" />
    <RestyleDialog
      v-if="restyleOpen && active"
      :post-id="active.id"
      :scope="scope"
      :scope-name="name(scope)"
      :title="draft.title"
      :dirty="dirty"
      @close="restyleOpen = false"
      @apply="applyRestyle"
    />
  </section>
</template>
