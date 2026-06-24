<script lang="ts">
  export let blockedUntil = 0;
  export let armed = false;            // фаза «Приготовиться» (баззер ещё не открыт)
  export let seq: { redAt: number; yellowAt: number; greenAt: number } | null = null;
  import { createEventDispatcher, onMount } from 'svelte';
  import { ringFraction, ringDashoffset } from './buzzerRing.js';
  const dispatch = createEventDispatcher();

  let now = performance.now();
  onMount(() => {
    const t = setInterval(() => (now = performance.now()), 30);
    return () => clearInterval(t);
  });

  $: blocked = now < blockedUntil;

  // Зафиксировать момент начала блокировки, чтобы рисовать фактический срок.
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
  $: msLeft = Math.max(0, Math.round(blockedUntil - now));

  // Стартовые огни F1: серый → красный → жёлтый → зелёный («ЖМИ»).
  $: stage =
    blocked ? 'blocked'
    : (armed || !seq) ? 'wait'
    : now < seq.redAt ? 'grey'
    : now < seq.yellowAt ? 'red'
    : now < seq.greenAt ? 'yellow'
    : 'green';

  const LABEL: Record<string, string> = {
    blocked: 'РАНО', wait: 'ЖДИТЕ', grey: 'ЖДИТЕ',
    red: 'ВНИМАНИЕ', yellow: 'ГОТОВЬСЬ', green: 'ЖМИ!',
  };
  const CAPTION: Record<string, string> = {
    blocked: 'Фальстарт! ещё рано', wait: 'Баззер скоро откроется', grey: 'Приготовьтесь…',
    red: 'Не жмите — ещё рано', yellow: 'Почти…', green: 'Жмите!',
  };

  function press() {
    if (blocked) return;
    if (stage === 'wait' || stage === 'grey') return; // серый — без штрафа, нажатие игнорируется
    dispatch('press'); // красный/жёлтый → фальстарт (reaction<0); зелёный → валидно
  }
</script>

<div class="wrap">
  <button class="buzzer is-{stage}" on:click={press}>
    {#if blocked}
      <svg class="ring" viewBox="0 0 240 240" aria-hidden="true">
        <circle cx="120" cy="120" r={R} fill="none" stroke="rgba(255,255,255,.18)" stroke-width="8" />
        <circle
          cx="120" cy="120" r={R} fill="none" stroke="#fff" stroke-width="8"
          stroke-linecap="round" stroke-dasharray={C} stroke-dashoffset={dash}
          transform="rotate(-90 120 120)" />
      </svg>
      <span class="num">{msLeft}<small>мс</small></span>
    {:else}
      <span class="label" class:sm={stage !== 'green'}>{LABEL[stage]}</span>
    {/if}
  </button>
  <div class="caption">{CAPTION[stage]}</div>
</div>

<style>
  .wrap { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .buzzer {
    position: relative; width: 240px; height: 240px; border-radius: 50%;
    border: none; cursor: pointer; color: #fff; font-family: var(--font-display);
    display: grid; place-items: center; transition: background .12s, box-shadow .12s;
  }
  .buzzer:active { transform: scale(.97); }
  .buzzer.is-green {
    background: radial-gradient(circle at 50% 45%, #43e9b0 0%, #1fd18e 60%, #149f6c 100%); color: #042;
    box-shadow: 0 0 0 10px rgba(31,209,142,.18), 0 18px 50px -8px rgba(31,209,142,.7);
    animation: pulseRing 1.1s infinite;
  }
  .buzzer.is-red { background: radial-gradient(circle at 50% 45%, #ff5d6c 0%, #e23048 70%); box-shadow: 0 0 40px -6px rgba(226,48,72,.6); }
  .buzzer.is-yellow { background: radial-gradient(circle at 50% 45%, #ffd24a 0%, #f5a623 70%); color: #3a2600; box-shadow: 0 0 40px -6px rgba(245,166,35,.6); }
  .buzzer.is-blocked { background: var(--grad-falsestart, #e23048); cursor: not-allowed; }
  .buzzer.is-wait, .buzzer.is-grey { background: #2a2740; box-shadow: inset 0 0 0 3px rgba(255,255,255,.12); color: var(--text-3, #9a93b8); }
  .label { font-size: 56px; font-weight: 700; letter-spacing: .04em; }
  .label.sm { font-size: 38px; letter-spacing: .1em; }
  .num { font-size: 72px; font-weight: 700; }
  .num small { font-size: 22px; font-weight: 600; opacity: .8; margin-left: 4px; }
  .ring { position: absolute; inset: 0; width: 240px; height: 240px; }
  .ring circle { transition: stroke-dashoffset .3s linear; }
  .caption { font-family: var(--font-ui); font-size: 15px; color: var(--text-2); }
</style>
