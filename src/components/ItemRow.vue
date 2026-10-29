<script setup lang="ts">
import { useAi } from '../ai'
import { goCreate } from '../nav'
import type { Item } from '../api'
import { useFavorites } from '../favorites'

const props = defineProps<{ item: Item; index?: number; source: string; showDesc?: boolean; trendable?: boolean }>()
defineEmits<{ search: [q: string]; trend: [] }>()
const { isFav, toggle } = useFavorites()
const { start } = useAi()
</script>

<template>
  <li class="row">
    <span v-if="index !== undefined" class="rank" :class="{ top: index < 3 }">{{ index + 1 }}</span>
    <div class="row-body">
      <a :href="item.url" target="_blank" rel="noopener noreferrer" class="row-title">{{ item.title }}</a>
      <span v-if="item.trend?.type === 'new'" class="trend-badge new" title="近 1 小时新上榜">新</span>
      <span v-else-if="item.trend?.type === 'up'" class="trend-badge up" :title="`近 1 小时上升 ${item.trend.delta} 名`">
        ↑{{ item.trend.delta }}
      </span>
      <p v-if="showDesc && item.desc" class="row-desc">{{ item.desc }}</p>
      <div v-if="item.hot || item.author || item.time" class="row-meta">
        <span v-if="item.hot" class="hot">{{ item.hot }}</span>
        <span v-if="item.author">{{ item.author }}</span>
        <span v-if="item.time">{{ item.time }}</span>
      </div>
    </div>
    <div class="row-actions">
      <button v-if="trendable" class="icon" title="查看热度走势" @click="$emit('trend')">📈</button>
      <button
        class="icon"
        title="AI 选题分析：值不值得写、怎么写"
        @click="start('analyze', { title: item.title, desc: item.desc, source: props.source, url: item.url })"
      >
        ✦
      </button>
      <button class="icon" title="写一篇：带着这个选题去创作" @click="goCreate({ title: item.title, desc: item.desc, source: props.source, url: item.url })">✍</button>
      <button class="icon" title="用这个词全网搜索" @click="$emit('search', item.title)">⌕</button>
      <button
        class="icon"
        :class="{ starred: isFav(item.url) }"
        :title="isFav(item.url) ? '取消收藏' : '收藏到素材库'"
        @click="toggle(item, props.source)"
      >
        {{ isFav(item.url) ? '★' : '☆' }}
      </button>
    </div>
  </li>
</template>
