<script setup lang="ts">
import { computed, ref } from 'vue'
import { MAX_TONES, useTones } from '../tones'

/** v-model：选中的类型名称列表 */
const model = defineModel<string[]>({ required: true })
defineProps<{ disabled?: boolean }>()

const { presets } = useTones()
const custom = ref('')

const customOnes = computed(() => model.value.filter((t) => !presets.value.some((p) => p.name === t)))
const full = computed(() => model.value.length >= MAX_TONES)

function toggle(name: string) {
  model.value = model.value.includes(name) ? model.value.filter((t) => t !== name) : full.value ? model.value : [...model.value, name]
}

function addCustom() {
  const name = custom.value.trim().slice(0, 10)
  if (name && !model.value.includes(name) && !full.value) model.value = [...model.value, name]
  custom.value = ''
}
</script>

<template>
  <div class="tone-picker">
    <div class="tone-head">
      <span>文章类型 / 语气</span>
      <span class="muted">最多选 {{ MAX_TONES }} 个{{ model.length ? `，已选 ${model.length} 个` : '，不选就用平台默认风格' }}</span>
      <button v-if="model.length" class="link" :disabled="disabled" @click="model = []">清空</button>
    </div>
    <div class="history">
      <button
        v-for="t in presets"
        :key="t.name"
        class="chip"
        :class="{ on: model.includes(t.name) }"
        :disabled="disabled || (full && !model.includes(t.name))"
        :title="t.desc"
        @click="toggle(t.name)"
      >
        {{ t.name }}
      </button>
      <button v-for="t in customOnes" :key="t" class="chip on" :disabled="disabled" @click="toggle(t)">
        {{ t }} ✕
      </button>
      <form v-if="!full" class="tone-custom" @submit.prevent="addCustom">
        <input v-model="custom" class="input" maxlength="10" placeholder="自定义，回车添加" :disabled="disabled" />
      </form>
    </div>
  </div>
</template>
