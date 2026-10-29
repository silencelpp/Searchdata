<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { api } from '../api'

const props = defineProps<{ title: string; size: 'wechat' | 'xiaohongshu' | 'wide' }>()
const emit = defineEmits<{ close: []; done: [name: string] }>()

const SIZES = {
  wechat: { name: '公众号封面', w: 900, h: 383 },
  xiaohongshu: { name: '小红书 3:4', w: 1080, h: 1440 },
  wide: { name: '横版 16:9', w: 1280, h: 720 },
} as const

const TEMPLATES = [
  { id: 'bold', name: '大字' },
  { id: 'gradient', name: '渐变' },
  { id: 'note', name: '便签' },
  { id: 'magazine', name: '杂志' },
] as const

const THEMES = [
  { id: 'orange', name: '橙', accent: '#ff5a36', soft: '#fff1ec', deep: '#b8381a' },
  { id: 'blue', name: '蓝', accent: '#2a78d6', soft: '#e8f1fc', deep: '#164a8a' },
  { id: 'green', name: '绿', accent: '#1baf7a', soft: '#e6f7f0', deep: '#0d6b4a' },
  { id: 'violet', name: '紫', accent: '#6250d6', soft: '#efedfc', deep: '#3a2d8f' },
  { id: 'ink', name: '黑', accent: '#1f2329', soft: '#f2f3f5', deep: '#000000' },
] as const

const opts = reactive({
  size: props.size as keyof typeof SIZES,
  template: 'bold' as (typeof TEMPLATES)[number]['id'],
  theme: 'orange' as (typeof THEMES)[number]['id'],
  title: props.title,
  sub: '',
})

const canvas = ref<HTMLCanvasElement>()
const saving = ref(false)
const error = ref('')
const size = computed(() => SIZES[opts.size])
const FONT = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif'

/** 不能出现在行首的标点：遇到时留在上一行末尾 */
const NO_LINE_START = /^[，。！？、；：）」』”’…%,.!?;:)\]}]+$/

/** 中文按字换行；英文单词尽量不拆开；标点不放在行首 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    const tokens = para.match(/[A-Za-z0-9.%+\-]+|\s+|./gu) ?? []
    for (const tk of tokens) {
      const next = line + tk
      if (ctx.measureText(next).width > maxWidth && line.trim() && !NO_LINE_START.test(tk)) {
        lines.push(line.trimEnd())
        line = tk.trimStart()
      } else {
        line = next
      }
    }
    if (line.trim()) lines.push(line.trimEnd())
  }
  return lines
}

/** 从大到小试字号，直到标题能放进指定行数 */
function fit(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number, start: number, min: number) {
  for (let s = start; s >= min; s -= 2) {
    ctx.font = `bold ${s}px ${FONT}`
    const lines = wrap(ctx, text, maxWidth)
    if (lines.length <= maxLines) return { size: s, lines }
  }
  ctx.font = `bold ${min}px ${FONT}`
  return { size: min, lines: wrap(ctx, text, maxWidth).slice(0, maxLines) }
}

function draw() {
  const c = canvas.value
  if (!c) return
  const { w, h } = size.value
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const t = THEMES.find((x) => x.id === opts.theme)!
  const title = opts.title.trim() || '标题'
  const sub = opts.sub.trim()
  const pad = Math.round(Math.min(w, h) * 0.1)
  const tall = h > w
  ctx.textBaseline = 'top'

  if (opts.template === 'bold') {
    ctx.fillStyle = t.soft
    ctx.fillRect(0, 0, w, h)
    ctx.fillStyle = t.accent
    ctx.fillRect(pad, pad, Math.round(w * 0.08), Math.round(h * 0.025) + 4)
    const { size: s, lines } = fit(ctx, title, w - pad * 2, tall ? 6 : 3, Math.round(h * (tall ? 0.09 : 0.2)), 28)
    const lh = s * 1.3
    let y = tall ? h * 0.3 : (h - lines.length * lh) / 2 + (sub ? -s * 0.3 : 0)
    ctx.fillStyle = '#1f2329'
    for (const l of lines) {
      ctx.fillText(l, pad, y)
      y += lh
    }
    if (sub) {
      ctx.font = `${Math.round(s * 0.42)}px ${FONT}`
      ctx.fillStyle = t.deep
      ctx.fillText(sub, pad, y + s * 0.3)
    }
  }

  if (opts.template === 'gradient') {
    const g = ctx.createLinearGradient(0, 0, w, h)
    g.addColorStop(0, t.accent)
    g.addColorStop(1, t.deep)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    ctx.textAlign = 'center'
    const { size: s, lines } = fit(ctx, title, w - pad * 2, tall ? 6 : 3, Math.round(h * (tall ? 0.085 : 0.19)), 28)
    const lh = s * 1.3
    const block = lines.length * lh + (sub ? s * 0.9 : 0)
    let y = (h - block) / 2
    ctx.fillStyle = '#ffffff'
    for (const l of lines) {
      ctx.fillText(l, w / 2, y)
      y += lh
    }
    if (sub) {
      ctx.font = `${Math.round(s * 0.42)}px ${FONT}`
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillText(sub, w / 2, y + s * 0.3)
    }
    ctx.textAlign = 'left'
  }

  if (opts.template === 'note') {
    ctx.fillStyle = '#fffaf0'
    ctx.fillRect(0, 0, w, h)
    // 横线信纸
    ctx.strokeStyle = 'rgba(0,0,0,0.06)'
    ctx.lineWidth = 2
    const gap = Math.round(h / (tall ? 18 : 9))
    for (let y = gap; y < h; y += gap) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(w, y)
      ctx.stroke()
    }
    const { size: s, lines } = fit(ctx, title, w - pad * 2, tall ? 6 : 3, Math.round(h * (tall ? 0.085 : 0.19)), 28)
    const lh = s * 1.45
    let y = tall ? h * 0.25 : (h - lines.length * lh) / 2
    for (const l of lines) {
      // 荧光笔划线
      ctx.fillStyle = t.accent + '55'
      ctx.fillRect(pad - 6, y + s * 0.55, ctx.measureText(l).width + 12, s * 0.5)
      ctx.fillStyle = '#1f2329'
      ctx.fillText(l, pad, y)
      y += lh
    }
    if (sub) {
      ctx.font = `${Math.round(s * 0.4)}px ${FONT}`
      ctx.fillStyle = '#5c636e'
      ctx.fillText(sub, pad, y + s * 0.2)
    }
  }

  if (opts.template === 'magazine') {
    ctx.fillStyle = '#16181c'
    ctx.fillRect(0, 0, w, h)
    const label = sub || '今日话题'
    const ls = Math.round(Math.min(w, h) * 0.05)
    ctx.font = `bold ${ls}px ${FONT}`
    const lw = ctx.measureText(label).width
    ctx.fillStyle = t.accent
    ctx.fillRect(pad, pad, lw + ls, ls * 1.7)
    ctx.fillStyle = '#ffffff'
    ctx.fillText(label, pad + ls / 2, pad + ls * 0.35)
    const { size: s, lines } = fit(ctx, title, w - pad * 2, tall ? 6 : 3, Math.round(h * (tall ? 0.09 : 0.18)), 28)
    const lh = s * 1.25
    let y = h - pad - lines.length * lh
    ctx.fillStyle = '#ffffff'
    for (const l of lines) {
      ctx.fillText(l, pad, y)
      y += lh
    }
    ctx.fillStyle = t.accent
    ctx.fillRect(pad, h - pad + s * 0.15, Math.round(w * 0.12), 6)
  }
}

watch(opts, () => nextTick(draw), { deep: true })
onMounted(() => (document.fonts?.ready ?? Promise.resolve()).then(draw))

async function use() {
  if (!canvas.value) return
  saving.value = true
  error.value = ''
  try {
    const { name } = await api.upload(canvas.value.toDataURL('image/png'))
    emit('done', name)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="drawer-mask center" @click.self="emit('close')">
    <section class="card dialog cover-maker">
      <header class="card-head">
        <h3>生成封面</h3>
        <button class="icon" title="关闭" @click="emit('close')">✕</button>
      </header>
      <div class="cover-maker-body">
        <div class="cover-stage" :class="{ tall: size.h > size.w }">
          <canvas ref="canvas" class="cover-canvas" />
        </div>
        <div class="dialog-body">
          <label class="field">
            <span>封面文字（可以按回车换行）</span>
            <textarea v-model="opts.title" class="input" rows="3" />
          </label>
          <label class="field">
            <span>{{ opts.template === 'magazine' ? '左上角标签' : '副标题（可选）' }}</span>
            <input v-model="opts.sub" class="input" maxlength="30" :placeholder="opts.template === 'magazine' ? '今日话题' : ''" />
          </label>
          <div class="field">
            <span>尺寸</span>
            <div class="history">
              <button v-for="(s, k) in SIZES" :key="k" class="chip" :class="{ on: opts.size === k }" @click="opts.size = k">
                {{ s.name }}
              </button>
            </div>
          </div>
          <div class="field">
            <span>样式</span>
            <div class="history">
              <button v-for="t in TEMPLATES" :key="t.id" class="chip" :class="{ on: opts.template === t.id }" @click="opts.template = t.id">
                {{ t.name }}
              </button>
            </div>
          </div>
          <div class="field">
            <span>配色</span>
            <div class="history">
              <button
                v-for="t in THEMES"
                :key="t.id"
                class="swatch"
                :class="{ on: opts.theme === t.id }"
                :style="{ background: t.accent }"
                :title="t.name"
                :aria-label="t.name"
                @click="opts.theme = t.id"
              />
            </div>
          </div>
          <p class="muted">{{ size.w }} × {{ size.h }} 像素，PNG 格式</p>
          <p v-if="error" class="error">{{ error }}</p>
        </div>
      </div>
      <footer class="drawer-foot">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn primary" :disabled="saving" @click="use">{{ saving ? '保存中…' : '用作封面' }}</button>
      </footer>
    </section>
  </div>
</template>
