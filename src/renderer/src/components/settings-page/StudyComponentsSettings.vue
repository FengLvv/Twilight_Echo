<script setup lang="ts">
import { computed, ref } from 'vue'
import SettingsDisclosure from './SettingsDisclosure.vue'
import { useStudyComponents, componentSize } from '../../stores/studyComponents.ts'
import { STUDY_FEATURES } from '../../../../shared/studyComponents.ts'
const components = useStudyComponents()
const inventoryOpen = ref(false)
const installed = computed(() => components.state.value?.catalog.components.filter(item => components.state.value?.components.find(row => row.id === item.id)?.phase === 'ready') ?? [])
const total = computed(() => installed.value.reduce((n, item) => n + item.installedBytes, 0))
const features = STUDY_FEATURES
</script>

<template>
  <div class="analysis-component-settings">
    <div class="setting-item">
      <div class="setting-copy"><strong>分析组件</strong><span>{{ componentSize(total) }}</span></div>
      <button class="preset-btn" type="button" @click="components.import().catch(() => {})">导入已有环境</button>
    </div>
    <div v-for="feature in features" :key="feature" class="setting-item">
      <span>{{ components.featureTitles[feature] }}</span>
      <span v-if="components.featureReady(feature)" class="component-installed"><i class="pi pi-check-circle" aria-hidden="true" /> 已安装</span>
      <button v-else type="button" class="preset-btn" :disabled="!components.state.value?.supported" @click="components.request([feature])">安装</button>
    </div>
    <div class="setting-item component-location">
      <span class="component-path" :title="components.state.value?.directory">{{ components.state.value?.directory }}</span>
      <button type="button" class="preset-btn" @click="components.directory().catch(() => {})">更改下载位置</button>
    </div>
    <button type="button" class="preset-btn inventory-toggle" :aria-expanded="inventoryOpen" aria-controls="analysis-installed-components" @click="inventoryOpen = !inventoryOpen">已安装组件 · {{ installed.length }} <i class="pi" :class="inventoryOpen ? 'pi-angle-up' : 'pi-angle-down'" aria-hidden="true" /></button>
    <SettingsDisclosure id="analysis-installed-components" :open="inventoryOpen">
      <div v-for="item in installed" :key="item.id" class="setting-item">
        <span>{{ item.title }}</span>
        <div class="component-actions"><span>{{ componentSize(item.installedBytes) }}</span><button type="button" class="preset-btn" :aria-label="`删除${item.title}`" @click="components.remove(item.id).catch(() => {})"><i class="pi pi-trash" aria-hidden="true" /></button></div>
      </div>
    </SettingsDisclosure>
    <p v-if="components.error.value" role="alert" class="component-error">{{ components.error.value }}</p>
  </div>
</template>

<style scoped>
.analysis-component-settings { display: grid; gap: 4px; }
.component-actions, .component-installed { display: inline-flex; align-items: center; gap: 10px; }
.component-actions, .component-installed, .component-path { color: var(--te-settings-text); }
.component-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.component-location { gap: 16px; }
.component-location button { flex: none; }
.component-error { color: var(--te-primary-500); font-size: 13px; overflow-wrap: anywhere; }
</style>
