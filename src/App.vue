<script setup lang="ts">
import { ref } from 'vue'
import CreatePanel from './components/CreatePanel.vue'
import AutoWritePanel from './components/AutoWritePanel.vue'
import { tab, type Tab } from './nav'
import HotBoard from './components/HotBoard.vue'
import SearchPanel from './components/SearchPanel.vue'
import FavoritesPanel from './components/FavoritesPanel.vue'
import AiDrawer from './components/AiDrawer.vue'
import AiSettings from './components/AiSettings.vue'
import AutomationPanel from './components/AutomationPanel.vue'
import PublishPanel from './components/PublishPanel.vue'
import PublishSettings from './components/PublishSettings.vue'
import { useAi } from './ai'
import { useAlerts } from './alerts'
import { useFavorites } from './favorites'
import { usePosts } from './posts'

const { state: ai } = useAi()
const alerts = useAlerts()
const posts = usePosts()

const keyword = ref('')

// 「更多工具」里的页面：平时收起，打开其中一个时保持展开
const TOOLS: Tab[] = ['hot', 'search', 'fav', 'create', 'auto']
const toolsOpen = ref(false)
const { list } = useFavorites()

function searchFor(q: string) {
  keyword.value = q
  tab.value = 'search'
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">◎</span>
      <span>选题雷达</span>
    </div>
    <nav class="tabs">
      <button :class="{ active: tab === 'auto-write' }" @click="tab = 'auto-write'">✦ 一键生成</button>
      <button :class="{ active: tab === 'publish' }" @click="tab = 'publish'">
        我的文章 <span v-if="posts.pending.value" class="count">{{ posts.pending.value }}</span>
      </button>
      <button class="tools-toggle" :class="{ open: toolsOpen || TOOLS.includes(tab) }" @click="toolsOpen = !toolsOpen">
        更多工具 {{ toolsOpen || TOOLS.includes(tab) ? '▴' : '▾' }}
      </button>
      <template v-if="toolsOpen || TOOLS.includes(tab)">
        <span class="tabs-sep" />
        <button :class="{ active: tab === 'hot' }" @click="tab = 'hot'">全网热榜</button>
        <button :class="{ active: tab === 'search' }" @click="tab = 'search'">关键词搜索</button>
        <button :class="{ active: tab === 'fav' }" @click="tab = 'fav'">
          素材库 <span v-if="list.length" class="count">{{ list.length }}</span>
        </button>
        <button :class="{ active: tab === 'create' }" @click="tab = 'create'">手动创作</button>
        <button :class="{ active: tab === 'auto' }" @click="tab = 'auto'">定时任务</button>
      </template>
    </nav>
    <button v-if="alerts.unread.value" class="btn settings-btn bell" title="监控提醒" @click="tab = 'auto'">
      🔔
      <span class="count">{{ alerts.unread.value }}</span>
    </button>
    <button class="btn" :class="{ 'settings-btn': !alerts.unread.value }" @click="ai.settingsOpen = true">⚙ AI 设置</button>
  </header>

  <main class="main">
    <AutoWritePanel v-if="tab === 'auto-write'" />
    <HotBoard v-show="tab === 'hot'" @search="searchFor" />
    <SearchPanel v-show="tab === 'search'" v-model="keyword" />
    <FavoritesPanel v-if="tab === 'fav'" @search="searchFor" />
    <AutomationPanel v-if="tab === 'auto'" @search="searchFor" />
    <CreatePanel v-show="tab === 'create'" />
    <PublishPanel v-if="tab === 'publish'" />
  </main>

  <AiDrawer />
  <AiSettings v-if="ai.settingsOpen" />
  <PublishSettings v-if="posts.settingsOpen.value" />
</template>
