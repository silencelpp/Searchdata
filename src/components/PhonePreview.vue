<script setup lang="ts">
import DOMPurify from 'dompurify'
import { computed, ref } from 'vue'
import { toPlain, toWechatHtml } from '../../shared/markdown'

/** 在电脑上模拟文章发到手机上的样子：公众号文章页、小红书笔记页、头条/知乎文章页 */
const props = defineProps<{
  platform: string
  title: string
  content: string
  tags: string[]
  cover?: string
  author?: string
}>()

const now = new Date()
const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
const shortDate = `${now.getMonth() + 1}-${now.getDate()}`
const time = now.toTimeString().slice(0, 5)

// 正文图片和外链在手机上有特殊表现，预览时简单处理
const wechatHtml = computed(() => DOMPurify.sanitize(toWechatHtml(props.content.replace(/!\[[^\]]*\]\([^)]*\)/g, ''))))
const articleHtml = computed(() => wechatHtml.value)
const xhsText = computed(() => toPlain(props.content))
const tagLine = computed(() => props.tags.map((t) => `#${t}`).join(' '))

const titleLen = computed(() => props.title.length)
const LIMIT: Record<string, number> = { wechat: 64, xiaohongshu: 20, toutiao: 30, zhihu: 100 }
const over = computed(() => titleLen.value > (LIMIT[props.platform] ?? 999))

// 小红书正文超过一屏后显示「展开」
const expanded = ref(false)
</script>

<template>
  <div class="phone-wrap">
    <div class="phone">
      <div class="phone-status">
        <span>{{ time }}</span>
        <span class="phone-notch" />
        <span>5G ▮▮▮ 🔋</span>
      </div>

      <!-- 微信公众号文章页 -->
      <div v-if="platform === 'wechat'" class="phone-screen wx">
        <div class="wx-nav"><span>✕</span><span class="wx-dots">···</span></div>
        <div class="wx-body">
          <h1 class="wx-title">{{ title || '标题' }}</h1>
          <div class="wx-meta">
            <span>{{ author || '作者' }}</span>
            <span class="wx-account">我的公众号</span>
            <span class="wx-date">{{ date }}</span>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- 已经过 DOMPurify 清洗 -->
          <div class="wx-content" v-html="wechatHtml" />
          <div class="wx-foot">
            <span>阅读 10万+</span>
            <span>♡ 赞</span>
            <span>↗ 分享</span>
            <span>✩ 在看</span>
          </div>
        </div>
      </div>

      <!-- 小红书笔记页 -->
      <div v-else-if="platform === 'xiaohongshu'" class="phone-screen xhs">
        <div class="xhs-nav">
          <span>‹</span>
          <span class="xhs-avatar" />
          <span class="xhs-name">我的小红书</span>
          <span class="xhs-follow">关注</span>
          <span>↗</span>
        </div>
        <div class="xhs-scroll">
          <div class="xhs-img">
            <img v-if="cover" :src="cover" alt="笔记图片" />
            <span v-else>还没有图片</span>
          </div>
          <div class="xhs-body">
            <h1 class="xhs-title">{{ title || '标题' }}</h1>
            <div class="xhs-text" :class="{ clamp: !expanded }">{{ xhsText }}</div>
            <button v-if="!expanded && xhsText.length > 180" class="xhs-more" @click="expanded = true">展开</button>
            <div v-if="tagLine" class="xhs-tags">{{ tagLine }}</div>
            <div class="xhs-date">{{ shortDate }} 发布</div>
          </div>
        </div>
        <div class="xhs-bar">
          <span class="xhs-input">说点什么...</span>
          <span>♡ 赞</span>
          <span>☆ 收藏</span>
          <span>💬</span>
        </div>
      </div>

      <!-- 今日头条 / 知乎文章页 -->
      <div v-else class="phone-screen art" :class="platform">
        <div class="art-nav">
          <span>‹</span>
          <span class="art-brand">{{ platform === 'zhihu' ? '知乎' : '今日头条' }}</span>
          <span>···</span>
        </div>
        <div class="art-body">
          <h1 class="art-title">{{ title || '标题' }}</h1>
          <div class="art-author">
            <span class="art-avatar" />
            <span>
              <strong>{{ author || '我的账号' }}</strong>
              <small>{{ date }}</small>
            </span>
            <span class="art-follow">{{ platform === 'zhihu' ? '+ 关注' : '关注' }}</span>
          </div>
          <img v-if="cover && platform === 'toutiao'" :src="cover" class="art-cover" alt="封面" />
          <!-- eslint-disable-next-line vue/no-v-html -- 已经过 DOMPurify 清洗 -->
          <div class="art-content" v-html="articleHtml" />
          <div v-if="tagLine" class="art-tags">
            <span v-for="t in tags" :key="t">{{ t }}</span>
          </div>
        </div>
      </div>
    </div>
    <p class="phone-tip" :class="{ warn: over }">
      {{ over ? `⚠ 标题 ${titleLen} 字，超过上限` : `标题 ${titleLen} 字` }} · 预览效果仅供参考，以平台实际显示为准
    </p>
  </div>
</template>

<style scoped>
.phone-wrap {
  display: grid;
  justify-items: center;
  gap: 8px;
}

.phone {
  width: 375px;
  height: 740px;
  max-height: calc(100vh - 160px);
  display: flex;
  flex-direction: column;
  border: 10px solid #1c1c1e;
  border-radius: 44px;
  background: #fff;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
}

.phone-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: none;
  height: 34px;
  padding: 0 22px;
  font-size: 12px;
  font-weight: 600;
}

.phone-notch {
  width: 90px;
  height: 22px;
  border-radius: 12px;
  background: #1c1c1e;
}

.phone-screen {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.phone-tip {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

.phone-tip.warn {
  color: #d4380d;
}

/* 微信 */
.wx-nav {
  display: flex;
  justify-content: space-between;
  flex: none;
  padding: 8px 16px;
  font-size: 16px;
  color: #1f2329;
}

.wx-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 24px;
}

.wx-title {
  margin: 4px 0 12px;
  font-size: 22px;
  line-height: 1.4;
  font-weight: 700;
  color: #1f2329;
}

.wx-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 22px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.3);
}

.wx-account {
  color: #576b95;
}

.wx-content :deep(*) {
  max-width: 100%;
}

.wx-content :deep(p),
.wx-content :deep(li) {
  font-size: 16px !important;
}

.wx-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 28px;
  padding-top: 14px;
  border-top: 1px solid #eee;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

/* 小红书 */
.xhs-nav {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: none;
  padding: 6px 14px;
  font-size: 18px;
}

.xhs-avatar {
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd1dc, #ff8fab);
}

.xhs-name {
  flex: 1;
  font-size: 14px;
}

.xhs-follow {
  padding: 3px 14px;
  border: 1px solid #ff2442;
  border-radius: 16px;
  color: #ff2442;
  font-size: 13px;
}

.xhs-scroll {
  flex: 1;
  overflow-y: auto;
}

.xhs-img {
  display: grid;
  place-items: center;
  aspect-ratio: 3 / 4;
  background: #f5f5f5;
  color: #aaa;
  font-size: 13px;
}

.xhs-img img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.xhs-body {
  padding: 14px 16px 20px;
}

.xhs-title {
  margin: 0 0 10px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.4;
  color: #333;
}

.xhs-text {
  font-size: 15px;
  line-height: 1.7;
  color: #333;
  white-space: pre-wrap;
}

.xhs-text.clamp {
  display: -webkit-box;
  -webkit-line-clamp: 7;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.xhs-more {
  padding: 0;
  border: 0;
  background: none;
  color: #13386c;
  font-size: 15px;
}

.xhs-tags {
  margin-top: 10px;
  color: #13386c;
  font-size: 15px;
  line-height: 1.7;
}

.xhs-date {
  margin-top: 12px;
  color: #999;
  font-size: 12px;
}

.xhs-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  padding: 10px 14px;
  border-top: 1px solid #eee;
  font-size: 13px;
  color: #333;
}

.xhs-input {
  flex: 1;
  padding: 7px 12px;
  border-radius: 18px;
  background: #f5f5f5;
  color: #999;
}

/* 头条 / 知乎 */
.art-nav {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: none;
  padding: 8px 16px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 16px;
}

.art-brand {
  font-weight: 700;
  font-size: 15px;
}

.art.toutiao .art-brand {
  color: #f04142;
}

.art.zhihu .art-brand {
  color: #1772f6;
}

.art-body {
  flex: 1;
  overflow-y: auto;
  padding: 14px 16px 24px;
}

.art-title {
  margin: 0 0 14px;
  font-size: 21px;
  line-height: 1.45;
  font-weight: 700;
  color: #222;
}

.art-author {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.art-author > span:nth-child(2) {
  display: grid;
  flex: 1;
  font-size: 14px;
}

.art-author small {
  color: #999;
  font-size: 12px;
}

.art-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #c3d9ff, #6aa0ff);
}

.art-follow {
  padding: 4px 12px;
  border-radius: 4px;
  background: #f04142;
  color: #fff;
  font-size: 13px;
}

.art.zhihu .art-follow {
  background: #1772f6;
}

.art-cover {
  width: 100%;
  margin-bottom: 14px;
  border-radius: 4px;
}

.art-content :deep(*) {
  max-width: 100%;
}

.art-content :deep(p),
.art-content :deep(li) {
  font-size: 17px !important;
  line-height: 1.8 !important;
  color: #222 !important;
}

.art-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}

.art-tags span {
  padding: 3px 10px;
  border-radius: 12px;
  background: #f4f5f7;
  color: #555;
  font-size: 13px;
}
</style>
