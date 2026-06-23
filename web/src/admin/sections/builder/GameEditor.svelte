<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let id: string;
  const dispatch = createEventDispatcher<{ back: void }>();
</script>

<header class="bar">
  <button class="ghost" on:click={() => dispatch('back')}>← Список игр</button>
  <span class="muted">Редактор игры {id}</span>
</header>

<style>
  .bar { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .muted { color: var(--text-2); }
</style>
