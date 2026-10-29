import { ref } from 'vue'
import type { AiTopic } from './ai'

/** 顶部导航和跨页面跳转：比如热榜上点「写一篇」直接带着选题跳到创作页 */
export type Tab = 'auto-write' | 'hot' | 'search' | 'fav' | 'create' | 'publish' | 'auto'

export const tab = ref<Tab>('auto-write')
export const createTopic = ref<AiTopic | null>(null)
/** 发布页打开时要选中的文章 */
export const openPostId = ref<string | null>(null)

export function goCreate(topic: AiTopic | null = null) {
  createTopic.value = topic
  tab.value = 'create'
}

export function goPublish(id: string) {
  openPostId.value = id
  tab.value = 'publish'
}
