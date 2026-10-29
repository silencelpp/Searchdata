<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { api, type PublishConfig } from '../api'
import { usePosts } from '../posts'

const { settingsOpen } = usePosts()

const current = ref<PublishConfig | null>(null)
const form = reactive({ appId: '', appSecret: '', author: '', openComment: true, browser: 'msedge' as 'msedge' | 'chrome' })
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const testMsg = ref('')
const browserMsg = ref('')

function payload() {
  return {
    wechat: { appId: form.appId, appSecret: form.appSecret, author: form.author, openComment: form.openComment },
    browser: form.browser,
  }
}

async function save(close = true) {
  saving.value = true
  error.value = ''
  try {
    current.value = await api.savePublishConfig(payload())
    form.appSecret = ''
    if (close) settingsOpen.value = false
  } catch (e) {
    error.value = (e as Error).message
    throw e
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  testMsg.value = ''
  error.value = ''
  try {
    await save(false)
    testMsg.value = (await api.testWechat()).message
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    testing.value = false
  }
}

async function closeBrowser() {
  await api.closeBrowser()
  browserMsg.value = '已关闭发布用的浏览器'
}

onMounted(async () => {
  current.value = await api.publishConfig()
  form.appId = current.value.wechat.appId
  form.author = current.value.wechat.author
  form.openComment = current.value.wechat.openComment
  form.browser = current.value.browser
})
</script>

<template>
  <div class="drawer-mask center" @click.self="settingsOpen = false">
    <form class="card dialog publish-settings" @submit.prevent="save()">
      <header class="card-head">
        <h3>发布设置</h3>
        <button type="button" class="icon" @click="settingsOpen = false">✕</button>
      </header>
      <div class="dialog-body">
        <h4 class="section-title">微信公众号（官方接口，推到草稿箱）</h4>
        <label class="field">
          <span>AppID</span>
          <input v-model="form.appId" class="input" placeholder="wx 开头" autocomplete="off" />
        </label>
        <label class="field">
          <span>AppSecret</span>
          <input
            v-model="form.appSecret"
            class="input"
            type="password"
            autocomplete="off"
            :placeholder="current?.wechat.hasSecret ? `已保存 ${current.wechat.secretHint}，留空则不修改` : ''"
          />
        </label>
        <label class="field">
          <span>作者名（可选，最多 16 字）</span>
          <input v-model="form.author" class="input" maxlength="16" />
        </label>
        <label class="check">
          <input v-model="form.openComment" type="checkbox" />
          文章开启留言
        </label>
        <p class="muted">
          在公众号后台「设置与开发 → 基本配置」获取 AppID 和 AppSecret，并把本机的出口 IP 加进「IP 白名单」。
          个人订阅号或未认证账号可能没有草稿箱接口权限，点「测试连接」可以先检查。
        </p>
        <div class="status-line">
          <span v-if="testMsg" class="ok-text">✓ {{ testMsg }}</span>
          <span v-else />
          <button type="button" class="btn" :disabled="testing || !form.appId" @click="test">
            {{ testing ? '测试中…' : '测试连接' }}
          </button>
        </div>

        <h4 class="section-title">小红书 / 今日头条 / 知乎（浏览器自动填写）</h4>
        <label class="field">
          <span>用哪个浏览器</span>
          <div class="history">
            <button type="button" class="chip" :class="{ on: form.browser === 'msedge' }" @click="form.browser = 'msedge'">Edge</button>
            <button type="button" class="chip" :class="{ on: form.browser === 'chrome' }" @click="form.browser = 'chrome'">Chrome</button>
          </div>
        </label>
        <p class="muted">
          发布时会打开一个独立的浏览器窗口。每个平台第一次需要你在窗口里扫码登录，之后会记住登录状态（保存在本机
          data/browser-profile）。软件不会保存你的账号密码，也不会替你点「发布」。
        </p>
        <div class="status-line">
          <span v-if="browserMsg" class="muted">{{ browserMsg }}</span>
          <span v-else />
          <button type="button" class="btn" @click="closeBrowser">关闭发布浏览器</button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </div>
      <footer class="drawer-foot">
        <button type="button" class="btn" @click="settingsOpen = false">取消</button>
        <button class="btn primary" :disabled="saving">保存</button>
      </footer>
    </form>
  </div>
</template>
