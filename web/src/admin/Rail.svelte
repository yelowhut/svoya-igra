<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { AdminRoute } from './route.js';
  export let current: AdminRoute;
  const dispatch = createEventDispatcher<{ navigate: AdminRoute; logout: void }>();
</script>

<nav class="rail">
  <div class="brand">
    <div class="logo">С</div>
    <div>
      <div class="brand-title">Своя игра</div>
      <div class="brand-sub">Студия · админ</div>
    </div>
  </div>

  <div class="group">
    <div class="group-label">Инструменты</div>
    <button class="item" class:active={current === 'builder'} on:click={() => dispatch('navigate', 'builder')}>Конструктор</button>
    <button class="item" class:active={current === 'base'} on:click={() => dispatch('navigate', 'base')}>База вопросов</button>
  </div>

  <div class="group">
    <div class="group-label">Ведущий</div>
    <button class="item" disabled title="Появится в Sub-project 3">Лобби и команды</button>
    <button class="item" disabled title="Появится в Sub-project 3">Пульт · игра</button>
  </div>

  <button class="logout" on:click={() => dispatch('logout')}>Выйти</button>
</nav>

<style>
  .rail {
    width: 252px; min-height: 100vh; box-sizing: border-box;
    background: var(--panel); border-right: 1px solid var(--border);
    padding: 20px 14px; display: flex; flex-direction: column; gap: 22px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .logo {
    width: 40px; height: 40px; border-radius: 12px; display: grid; place-items: center;
    font-family: var(--font-display); font-weight: 700; color: #fff;
    background: linear-gradient(135deg, var(--accent), var(--buzzer));
  }
  .brand-title { font-family: var(--font-display); text-transform: uppercase; letter-spacing: .04em; }
  .brand-sub { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; }
  .group { display: flex; flex-direction: column; gap: 4px; }
  .group-label { color: var(--text-3); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; padding: 0 8px 4px; }
  .item {
    text-align: left; padding: 10px 12px; border-radius: var(--r-control);
    border: 1px solid transparent; background: transparent; color: var(--text-2);
    font: inherit; cursor: pointer;
  }
  .item:hover:not(:disabled) { background: var(--cell); color: var(--text); }
  .item.active { background: var(--cell-hover); color: var(--text); border-color: var(--border-accent); }
  .item:disabled { color: var(--text-4); cursor: not-allowed; }
  .logout {
    margin-top: auto; padding: 10px 12px; border-radius: var(--r-control);
    border: 1px solid var(--border); background: transparent; color: var(--text-2);
    font: inherit; cursor: pointer;
  }
  .logout:hover { background: var(--cell); color: var(--text); }
</style>
