<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAi, type AiConfig } from '../ai'
import { api } from '../api'

const { state } = useAi()

// 都是 OpenAI 兼容接口；模型名可能随平台更新而变化，可以手动修改
const PRESETS = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-flash', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { name: '通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.8-flash', keyUrl: 'https://bailian.console.aliyun.com/' },
  { name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k3', keyUrl: 'https://platform.kimi.com/console/api-keys' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-5.3-flash', keyUrl: 'https://open.bigmodel.cn/usercenter/apikeys' },
]

const current = ref<AiConfig | null>(null)
const form = reactive({ baseUrl: '', model: '', apiKey: '' })
const saving = ref(false)
const error = ref('')

function applyPreset(p: (typeof PRESETS)[number]) {
  form.baseUrl = p.baseUrl
  form.model = p.model
}

const activePreset = () => PRESETS.find((p) => p.baseUrl === form.baseUrl)

async function save() {
  saving.value = true
  error.value = ''
  try {
    current.value = await api.saveAiConfig({ ...form })
    form.apiKey = ''
    state.settingsOpen = false
  } catch (e) {
    error.value = (e as Error).message
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  current.value = await api.aiConfig()
  form.baseUrl = current.value.baseUrl
  form.model = current.value.model
})
</script>

<template>
  <div class="drawer-mask center" @click.self="state.settingsOpen = false">
    <form class="card dialog" @submit.prevent="save">
      <header class="card-head">
        <h3>AI 设置</h3>
        <button type="button" class="icon" @click="state.settingsOpen = false">✕</button>
      </header>
      <div class="dialog-body">
        <label class="field">
          <span>服务商</span>
          <div class="history">
            <button
              v-for="p in PRESETS"
              :key="p.name"
              type="button"
              class="chip"
              :class="{ on: activePreset()?.name === p.name }"
              @click="applyPreset(p)"
            >
              {{ p.name }}
            </button>
          </div>
        </label>
        <label class="field">
          <span>接口地址（OpenAI 兼容）</span>
          <input v-model="form.baseUrl" class="input" required />
        </label>
        <label class="field">
          <span>模型名称</span>
          <input v-model="form.model" class="input" required />
        </label>
        <label class="field">
          <span>
            API Key
            <a v-if="activePreset()" :href="activePreset()!.keyUrl" target="_blank" rel="noopener noreferrer" class="tag">
              去申请
            </a>
          </span>
          <input
            v-model="form.apiKey"
            class="input"
            type="password"
            autocomplete="off"
            :placeholder="current?.hasKey ? `已保存 ${current.keyHint}，留空则不修改` : 'sk-...'"
          />
        </label>
        <p class="muted">Key 只保存在本机的 data/ai-config.json 中，不会发给前端页面。</p>
        <p v-if="error" class="error">{{ error }}</p>
      </div>
      <footer class="drawer-foot">
        <button type="button" class="btn" @click="state.settingsOpen = false">取消</button>
        <button class="btn primary" :disabled="saving">保存</button>
      </footer>
    </form>
  </div>
</template>
