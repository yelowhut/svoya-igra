<script lang="ts">
  export let round: any;
  export let usedQuestionIds: string[] = [];
  export let selectedId: string | null = null;
  export let clickable = false;
  export let tv = false;   // ТВ-режим: крупный скейл под вьюпорт, широкие плашки категорий
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
  const isUsed = (id: string) => usedQuestionIds.includes(id);
</script>

<div class="matrix" class:tv style="--rows:{(round?.categories ?? []).length || 1}">
  {#each round?.categories ?? [] as cat}
    <div class="row" style="grid-template-columns: var(--cat-w, 10rem) repeat({cat.questions.length}, 1fr)">
      <div class="cat">{cat.name}</div>
      {#each cat.questions as q}
        <button
          class="cell {isUsed(q.id) ? 'used' : ''} {selectedId === q.id ? 'selected' : ''}"
          disabled={!clickable || isUsed(q.id)}
          on:click={() => dispatch('select', { questionId: q.id, value: q.value, special: q.special })}>
          {#if isUsed(q.id)}
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M5 13l4 4L19 7" fill="none" stroke="currentColor"
                stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          {:else}
            {q.value}
          {/if}
        </button>
      {/each}
    </div>
  {/each}
</div>

<style>
  .matrix { display: grid; gap: 8px; }
  .row { display: grid; gap: 8px; align-items: center; }
  .cat {
    font-family: var(--font-display); font-weight: 600; font-size: 15px;
    text-transform: uppercase; letter-spacing: .03em; color: var(--text);
    background: var(--grad-rowlabel); border: 1px solid var(--border);
    border-radius: var(--r-control); padding: 12px 14px;
  }
  .cell {
    padding: 16px; background: var(--cell); border: 1px solid var(--border);
    border-radius: var(--r-control); color: var(--gold);
    font-family: var(--font-display); font-size: 26px; font-weight: 700;
    cursor: pointer; transition: background .12s;
  }
  .cell:not(:disabled):hover { background: var(--cell-hover); }
  .cell.selected { border-color: var(--accent); box-shadow: 0 0 0 2px var(--border-accent); }
  .cell.used { background: #100d1c; color: var(--text-4); cursor: default; }

  /* ── ТВ-режим: матрица скейлится под вьюпорт ──────────────────────────────
     Колонка категорий вдвое шире (10rem → ~20rem, со скейлом по ширине окна),
     плашки категорий по высоте равны клеткам цен (align-items: stretch),
     текст внутри — максимально крупный, через clamp() под размер экрана. */
  /* Матрица занимает всю доступную высоту: ряды делят её поровну (grid-auto-rows:1fr),
     min-height:0 на каждом уровне позволяет рядам/клеткам сжиматься ниже контента —
     иначе крупный шрифт задрал бы высоту и появился бы скролл. Шрифт ограничен сверху
     долей высоты ряда (calc(.../rows)), чтобы не вылезать при большом числе категорий. */
  .matrix.tv {
    --cat-w: clamp(16rem, 20vw, 30rem);
    width: 100%; height: 100%; flex: 1; min-height: 0;
    grid-auto-rows: 1fr; gap: clamp(6px, 0.8vw, 16px);
  }
  .matrix.tv .row { align-items: stretch; min-height: 0; gap: clamp(6px, 0.8vw, 16px); }
  .matrix.tv .cat {
    display: flex; align-items: center; justify-content: center; text-align: center;
    min-height: 0; overflow: hidden; padding: clamp(6px, 1vw, 24px);
    font-size: min(clamp(18px, 2vw, 44px), calc(62vh / var(--rows)));
    line-height: 1.05; overflow-wrap: anywhere; hyphens: auto;
  }
  .matrix.tv .cell {
    display: flex; align-items: center; justify-content: center;
    min-height: 0; overflow: hidden; padding: clamp(6px, 1vw, 24px);
    font-size: min(clamp(24px, 3vw, 60px), calc(70vh / var(--rows)));
  }
  .matrix.tv .cell svg { width: clamp(24px, 2.6vw, 52px); height: clamp(24px, 2.6vw, 52px); }
</style>
