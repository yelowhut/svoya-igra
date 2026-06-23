<script lang="ts">
  export let blockedUntil = 0;
  import { createEventDispatcher, onMount } from 'svelte';
  import { ringFraction, ringDashoffset, secondsLeft } from './buzzerRing.js';
  const dispatch = createEventDispatcher();

  let now = 0;
  onMount(() => {
    const t = setInterval(() => (now = performance.now()), 50);
    return () => clearInterval(t);
  });

  $: blocked = now < blockedUntil;

  // Зафиксировать момент начала блокировки, чтобы рисовать фактический срок (он эскалирующий).
  let blockStart = 0;
  let prevUntil = 0;
  $: if (blockedUntil > prevUntil && blockedUntil > now) {
    blockStart = now;
    prevUntil = blockedUntil;
  }

  const R = 110;
  const C = 2 * Math.PI * R;
  $: frac = ringFraction(now, blockStart, blockedUntil);
  $: dash = ringDashoffset(frac, C);
  $: secs = secondsLeft(now, blockedUntil);
</script>

<div class="wrap">
  <button
    class="buzzer {blocked ? 'is-blocked' : 'is-open'}"
    disabled={blocked}
    on:click={() => dispatch('press')}>
    {#if blocked}
      <svg class="ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r={R} fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8" />
        <circle
          cx="120" cy="120" r={R} fill="none" stroke="#fff" stroke-width="8"
          stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={dash}
          transform="rotate(-90 120 120)" />
      </svg>
      <span class="num">{secs}</span>
    {:else}
      <span class="label">ЖМУ</span>
    {/if}
  </button>
  <div class="caption">{blocked ? 'Фальстарт!' : 'Нажмите, когда откроется'}</div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .buzzer {
    position: relative; width: 240px; height: 240px; border-radius: 50%;
    border: none; cursor: pointer; color: #fff; font-family: var(--font-display);
    display: grid; place-items: center;
  }
  .buzzer.is-open {
    background: var(--grad-buzzer);
    box-shadow: 0 0 0 10px rgba(255, 45, 120, .16), 0 18px 50px -8px rgba(255, 45, 120, .7);
    animation: pulseRing 1.4s infinite;
  }
  .buzzer.is-open:active { transform: scale(.96); }
  .buzzer.is-blocked { background: var(--grad-falsestart); cursor: not-allowed; }
  .label { font-size: 64px; font-weight: 700; letter-spacing: .04em; }
  .num { font-size: 86px; font-weight: 700; }
  .ring { position: absolute; inset: 0; width: 240px; height: 240px; }
  .ring circle { transition: stroke-dashoffset 1s linear; }
  .caption { font-family: var(--font-ui); font-size: 15px; color: var(--text-2); }
</style>
