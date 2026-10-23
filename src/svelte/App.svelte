<script lang="ts">
  import { onMount } from 'svelte';
  import AtlasHeader from './components/AtlasHeader.svelte';
  import MapViewport from './components/MapViewport.svelte';
  import ChroniclePane from './components/ChroniclePane.svelte';
  import TimelineDock from './components/TimelineDock.svelte';
  import { provideAtlas } from './context';

  const { state, retry, dispose } = provideAtlas();
  // Returning cleanup synchronously protects even a still-loading session.
  onMount(() => { void retry(); return dispose; });
</script>

<div id="atlas-shell" aria-busy={$state.status === 'loading'}>
  <AtlasHeader />
  <main id="workspace-body">
    <MapViewport />
    <ChroniclePane />
  </main>
  <TimelineDock />
</div>
{#if $state.status !== 'ready'}
  <div class="atlas-loading" role="status">
    {#if $state.status === 'error'}
      <p>{$state.error}</p>
      <button type="button" onclick={retry}>重新加载</button>
    {:else}
      <span>正在加载历史地图…</span>
    {/if}
  </div>
{/if}
