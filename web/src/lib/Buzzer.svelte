<script lang="ts">
  export let blockedUntil = 0;
  import { createEventDispatcher, onMount } from 'svelte';
  const dispatch = createEventDispatcher();
  let now = 0; onMount(() => { const t = setInterval(() => now = performance.now(), 50); return () => clearInterval(t); });
  $: blocked = now < blockedUntil;
</script>
<button on:click={() => dispatch('press')} disabled={blocked}
  style="width:80vw;height:40vh;border-radius:2rem;border:none;font-size:3rem;font-weight:900;
  background:{blocked?'#333':'radial-gradient(circle,var(--neon2),#a00)'};color:#fff;
  box-shadow:0 0 40px {blocked?'#000':'var(--neon2)'}">
  {blocked ? 'БЛОК' : 'ОТВЕТ'}
</button>
