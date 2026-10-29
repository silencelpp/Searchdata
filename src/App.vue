<script setup lang="ts">
import { ref } from 'vue'
import HotBoard from './components/HotBoard.vue'
import SearchPanel from './components/SearchPanel.vue'
import FavoritesPanel from './components/FavoritesPanel.vue'
import AiDrawer from './components/AiDrawer.vue'
import AiSettings from './components/AiSettings.vue'
import AutomationPanel from './components/AutomationPanel.vue'
import { useAi } from './ai'
import { useAlerts } from './alerts'
import { useFavorites } from './favorites'

const { state: ai } = useAi()
const alerts = useAlerts()

type Tab = 'hot' | 'search' | 'fav' | 'auto'
const tab = ref<Tab>('hot')
const keyword = ref('')
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
      <button :class="{ active: tab === 'hot' }" @click="tab = 'hot'">全网热榜</button>
      <button :class="{ active: tab === 'search' }" @click="tab = 'search'">关键词搜索</button>
      <button :class="{ active: tab === 'fav' }" @click="tab = 'fav'">
        素材库 <span v-if="list.length" class="count">{{ list.length }}</span>
      </button>
      <button :class="{ active: tab === 'auto' }" @click="tab = 'auto'">自动化</button>
    </nav>
    <button class="btn settings-btn bell" title="监控提醒" @click="tab = 'auto'">
      🔔 提醒
      <span v-if="alerts.unread.value" class="count">{{ alerts.unread.value }}</span>
    </button>
    <button class="btn" @click="ai.settingsOpen = true">⚙ AI 设置</button>
  </header>

  <main class="main">
    <HotBoard v-show="tab === 'hot'" @search="searchFor" />
    <SearchPanel v-show="tab === 'search'" v-model="keyword" />
    <FavoritesPanel v-if="tab === 'fav'" @search="searchFor" />
    <AutomationPanel v-if="tab === 'auto'" @search="searchFor" />
  </main>

  <AiDrawer />
  <AiSettings v-if="ai.settingsOpen" />
</template>
