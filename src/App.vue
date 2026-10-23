<script setup lang="ts">
import AtlasHeader from './components/AtlasHeader.vue';
import MapViewport from './components/MapViewport.vue';
import ChroniclePane from './components/ChroniclePane.vue';
import TimelineDock from './components/TimelineDock.vue';
import { provideAtlas } from './composables/useAtlas';

const { status, error, retry } = provideAtlas();
</script>

<template>
  <div id="atlas-shell" :aria-busy="status === 'loading'">
    <AtlasHeader />
    <main id="workspace-body">
      <MapViewport />
      <ChroniclePane />
    </main>
    <TimelineDock />
  </div>
  <div v-if="status !== 'ready'" class="atlas-loading" role="status">
    <template v-if="status === 'error'">
      <p>{{ error }}</p>
      <button type="button" @click="retry">重新加载</button>
    </template>
    <span v-else>正在加载历史地图…</span>
  </div>
</template>
