import { computed, ref } from 'vue'
import { api, type Alert } from './api'

// 全局共享的监控提醒：每分钟拉一次，有新提醒时（如果允许）弹桌面通知
const list = ref<Alert[]>([])
const notifyEnabled = ref(typeof Notification !== 'undefined' && Notification.permission === 'granted')
let started = false
let known: Set<string> | null = null

async function refresh() {
  try {
    const next = await api.alerts()
    if (known && notifyEnabled.value) {
      const fresh = next.filter((a) => !known!.has(a.id) && !a.read)
      if (fresh.length) {
        const n = new Notification(`选题雷达：命中 ${fresh.length} 条监控关键词`, {
          body: fresh
            .slice(0, 3)
            .map((a) => `【${a.keyword}】${a.title}`)
            .join('\n'),
        })
        n.onclick = () => window.focus()
      }
    }
    known = new Set(next.map((a) => a.id))
    list.value = next
  } catch {
    // 后端暂时连不上时静默，下次再试
  }
}

async function enableNotify() {
  if (typeof Notification === 'undefined') return
  notifyEnabled.value = (await Notification.requestPermission()) === 'granted'
}

async function markRead(ids?: string[]) {
  await api.markAlertsRead(ids)
  list.value = list.value.map((a) => (!ids || ids.includes(a.id) ? { ...a, read: true } : a))
}

async function clear() {
  await api.clearAlerts()
  list.value = []
}

export function useAlerts() {
  if (!started) {
    started = true
    refresh()
    setInterval(refresh, 60_000)
  }
  const unread = computed(() => list.value.filter((a) => !a.read).length)
  return { list, unread, refresh, markRead, clear, notifyEnabled, enableNotify }
}
