<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  export let title = '';
  const dispatch = createEventDispatcher<{ close: void }>();
  function onKey(e: KeyboardEvent) { if (e.key === 'Escape') dispatch('close'); }
</script>

<svelte:window on:keydown={onKey} />

<div class="overlay">
  <div class="dialog" role="dialog" aria-modal="true">
    {#if title}<h2 class="title">{title}</h2>{/if}
    <slot />
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; background: rgba(0, 0, 0, .6); display: grid; place-items: center; z-index: 50; }
  .dialog { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); box-shadow: var(--shadow-card); padding: 22px; width: 360px; max-width: calc(100vw - 32px); }
  .title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .03em; font-size: 16px; margin: 0 0 14px; color: var(--text); }
</style>
