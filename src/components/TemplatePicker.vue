<script setup lang="ts">
import { computed } from 'vue'
import { useTemplates } from '../templates'

/** v-model：模版 id（'' 表示不用模版，'custom' 表示自定义）；v-model:custom：自定义结构 */
const model = defineModel<string>({ required: true })
const customText = defineModel<string>('custom', { required: true })
defineProps<{ disabled?: boolean }>()

const { presets } = useTemplates()
const current = computed(() => presets.value.find((t) => t.id === model.value))
</script>

<template>
  <div class="tpl-picker">
    <div class="tone-head">
      <span>文章结构</span>
      <span class="muted">AI 会按这个结构写</span>
    </div>
    <div class="tpl-grid">
      <button class="tpl" :class="{ on: model === '' }" :disabled="disabled" @click="model = ''">
        <strong>不限</strong>
        <span>AI 自己决定结构</span>
      </button>
      <button v-for="t in presets" :key="t.id" class="tpl" :class="{ on: model === t.id }" :disabled="disabled" @click="model = t.id">
        <strong>{{ t.name }}</strong>
        <span>{{ t.desc }}</span>
      </button>
      <button class="tpl" :class="{ on: model === 'custom' }" :disabled="disabled" @click="model = 'custom'">
        <strong>自定义</strong>
        <span>自己写一个结构</span>
      </button>
    </div>
    <pre v-if="current" class="tpl-structure">{{ current.structure }}</pre>
    <textarea
      v-if="model === 'custom'"
      v-model="customText"
      class="input"
      rows="5"
      maxlength="1000"
      :disabled="disabled"
      placeholder="按顺序写出每一部分，例如：&#10;1. 开头：用一句反问抓住读者&#10;2. 讲三个真实案例&#10;3. 结尾：给一个马上能做的建议"
    />
  </div>
</template>
