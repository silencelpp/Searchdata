<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { api, type TrendPoint } from '../api'

const props = defineProps<{ source: string; sourceName: string; title: string }>()
const emit = defineEmits<{ close: [] }>()

const points = ref<TrendPoint[]>([])
const loading = ref(true)
const error = ref('')
const hover = ref<number | null>(null)
const showTable = ref(false)

// 单系列折线：排名（1 在最上面）。热度数值放在悬停提示和表格里，不做第二条轴
const W = 640
const H = 240
const PAD = { top: 16, right: 20, bottom: 28, left: 40 }
const iw = W - PAD.left - PAD.right
const ih = H - PAD.top - PAD.bottom

const tMin = computed(() => points.value[0]?.at ?? 0)
const tMax = computed(() => points.value.at(-1)?.at ?? 1)
const maxRank = computed(() => {
  const m = Math.max(10, ...points.value.map((p) => p.rank))
  return Math.ceil(m / 10) * 10
})

const x = (t: number) => PAD.left + (tMax.value === tMin.value ? iw / 2 : ((t - tMin.value) / (tMax.value - tMin.value)) * iw)
const y = (rank: number) => PAD.top + ((rank - 1) / (maxRank.value - 1)) * ih

/** 相邻快照间隔超过 2 小时（比如后端没开）就断开折线，不画假的连接 */
const segments = computed(() => {
  const segs: TrendPoint[][] = []
  for (const p of points.value) {
    const last = segs.at(-1)?.at(-1)
    if (!last || p.at - last.at > 2 * 3600_000) segs.push([p])
    else segs.at(-1)!.push(p)
  }
  return segs.map((s) => s.map((p) => `${x(p.at).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' '))
})

const yTicks = computed(() => {
  const step = maxRank.value <= 20 ? 5 : 10
  const ticks = [1]
  for (let r = step; r <= maxRank.value; r += step) ticks.push(r)
  return ticks
})

const xTicks = computed(() => {
  if (points.value.length < 2) return []
  return Array.from({ length: 5 }, (_, i) => tMin.value + ((tMax.value - tMin.value) * i) / 4)
})

const fmtTime = (t: number) => {
  const d = new Date(t)
  const sameDay = new Date().toDateString() === d.toDateString()
  return d.toLocaleString('zh-CN', sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const fmtHot = (v: number | null) => (v == null ? '—' : v >= 10000 ? `${(v / 10000).toFixed(1)}万` : String(v))

const best = computed(() => (points.value.length ? Math.min(...points.value.map((p) => p.rank)) : null))
const latest = computed(() => points.value.at(-1))

function onMove(e: MouseEvent) {
  if (!points.value.length) return
  const svg = e.currentTarget as SVGSVGElement
  const rect = svg.getBoundingClientRect()
  const px = ((e.clientX - rect.left) / rect.width) * W
  let idx = 0
  let dist = Infinity
  points.value.forEach((p, i) => {
    const d = Math.abs(x(p.at) - px)
    if (d < dist) {
      dist = d
      idx = i
    }
  })
  hover.value = idx
}

const hoverPoint = computed(() => (hover.value == null ? null : points.value[hover.value]))
const tipLeft = computed(() => (hoverPoint.value ? (x(hoverPoint.value.at) / W) * 100 : 0))

onMounted(async () => {
  try {
    points.value = await api.trend(props.source, props.title)
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="drawer-mask center" @click.self="emit('close')">
    <section class="card dialog trend-dialog viz-root">
      <header class="card-head">
        <h3>热度走势</h3>
        <button class="icon" title="关闭" @click="emit('close')">✕</button>
      </header>
      <div class="dialog-body">
        <div>
          <div class="row-title trend-title">{{ title }}</div>
          <div class="row-meta">
            <span class="badge">{{ sourceName }}</span>
            <template v-if="latest">
              <span>当前第 {{ latest.rank }} 名</span>
              <span>最高第 {{ best }} 名</span>
              <span>共 {{ points.length }} 次记录</span>
            </template>
          </div>
        </div>

        <p v-if="loading" class="muted">加载中…</p>
        <p v-else-if="error" class="error">{{ error }}</p>
        <p v-else-if="points.length < 2" class="muted trend-empty">
          记录还不够画出走势。后端运行时会定时记录热榜快照，过一段时间再来看。
        </p>
        <template v-else>
          <div class="chart-wrap">
            <svg
              :viewBox="`0 0 ${W} ${H}`"
              class="chart"
              role="img"
              :aria-label="`${title} 在${sourceName}的排名走势`"
              @mousemove="onMove"
              @mouseleave="hover = null"
            >
              <g class="grid">
                <line v-for="r in yTicks" :key="r" :x1="PAD.left" :x2="W - PAD.right" :y1="y(r)" :y2="y(r)" />
              </g>
              <g class="axis">
                <text v-for="r in yTicks" :key="r" :x="PAD.left - 8" :y="y(r) + 4" text-anchor="end">{{ r }}</text>
                <text
                  v-for="(t, i) in xTicks"
                  :key="t"
                  :x="x(t)"
                  :y="H - 8"
                  :text-anchor="i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'"
                >
                  {{ fmtTime(t) }}
                </text>
              </g>
              <polyline v-for="(s, i) in segments" :key="i" class="line" :points="s" />
              <circle
                v-if="latest"
                class="dot"
                :cx="x(latest.at)"
                :cy="y(latest.rank)"
                r="4"
              />
              <g v-if="hoverPoint">
                <line class="crosshair" :x1="x(hoverPoint.at)" :x2="x(hoverPoint.at)" :y1="PAD.top" :y2="H - PAD.bottom" />
                <circle class="dot" :cx="x(hoverPoint.at)" :cy="y(hoverPoint.rank)" r="5" />
              </g>
            </svg>
            <div v-if="hoverPoint" class="tooltip" :style="{ left: `${tipLeft}%` }">
              <div class="muted">{{ fmtTime(hoverPoint.at) }}</div>
              <div><span class="key" />第 {{ hoverPoint.rank }} 名</div>
              <div class="muted">热度 {{ fmtHot(hoverPoint.hotValue) }}</div>
            </div>
          </div>
          <div class="chart-foot">
            <span class="muted">纵轴为排名，越靠上越热</span>
            <button class="link" @click="showTable = !showTable">{{ showTable ? '收起表格' : '查看表格' }}</button>
          </div>
          <div v-if="showTable" class="trend-table">
            <table>
              <thead>
                <tr><th>时间</th><th>排名</th><th>热度</th></tr>
              </thead>
              <tbody>
                <tr v-for="p in [...points].reverse()" :key="p.at">
                  <td>{{ fmtTime(p.at) }}</td>
                  <td>{{ p.rank }}</td>
                  <td>{{ fmtHot(p.hotValue) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </div>
    </section>
  </div>
</template>

<style scoped>
.viz-root {
  --surface-1: #fff;
  --series-1: #2a78d6;
  --grid: #eceef1;
  --axis-text: #8a919c;
}

.trend-dialog {
  width: min(720px, 94vw);
}

.trend-title {
  font-size: 15px;
  font-weight: 600;
}

.trend-empty {
  padding: 32px 0;
  text-align: center;
}

.chart-wrap {
  position: relative;
}

.chart {
  display: block;
  width: 100%;
  height: auto;
  cursor: crosshair;
}

.grid line {
  stroke: var(--grid);
  stroke-width: 1;
}

.axis text {
  fill: var(--axis-text);
  font-size: 11px;
}

.line {
  fill: none;
  stroke: var(--series-1);
  stroke-width: 2;
  stroke-linejoin: round;
  stroke-linecap: round;
}

.dot {
  fill: var(--series-1);
  stroke: var(--surface-1);
  stroke-width: 2;
}

.crosshair {
  stroke: var(--axis-text);
  stroke-width: 1;
}

.tooltip {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--card);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  font-size: 12px;
  line-height: 1.6;
  white-space: nowrap;
  pointer-events: none;
}

.key {
  display: inline-block;
  width: 10px;
  height: 2px;
  margin-right: 6px;
  vertical-align: middle;
  background: var(--series-1);
}

.chart-foot {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
}

.trend-table {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.trend-table table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}

.trend-table th,
.trend-table td {
  padding: 6px 12px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.trend-table th {
  position: sticky;
  top: 0;
  background: #fafbfc;
  color: var(--muted);
  font-weight: 500;
}
</style>
