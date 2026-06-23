<script lang="ts">
  import { onMount } from 'svelte';
  import { route, navigate, initRouter } from './router.js';
  import { getSession, login, logout } from './api.js';
  import type { AdminRoute } from './route.js';
  import Rail from './Rail.svelte';
  import Base from './sections/Base.svelte';
  import Builder from './sections/Builder.svelte';

  let status: 'loading' | 'login' | 'ready' = 'loading';
  let password = '';
  let loginError = '';

  onMount(async () => {
    initRouter();
    status = (await getSession()) ? 'ready' : 'login';
  });

  async function submitLogin() {
    loginError = '';
    if (await login(password)) {
      password = '';
      status = 'ready';
    } else {
      loginError = 'Неверный пароль';
    }
  }

  async function doLogout() {
    await logout();
    status = 'login';
  }

  function onNavigate(e: CustomEvent<AdminRoute>) { navigate(e.detail); }
</script>

{#if status === 'loading'}
  <div class="center"><p class="muted">Загрузка…</p></div>
{:else if status === 'login'}
  <div class="center">
    <form class="login" on:submit|preventDefault={submitLogin}>
      <h1>Своя игра</h1>
      <p class="muted">Вход администратора</p>
      <input type="password" bind:value={password} placeholder="Пароль" autocomplete="current-password" />
      {#if loginError}<p class="err">{loginError}</p>{/if}
      <button type="submit">Войти</button>
    </form>
  </div>
{:else}
  <div class="shell">
    <Rail current={$route} on:navigate={onNavigate} on:logout={doLogout} />
    <main class="content">
      {#if $route === 'builder'}<Builder />{:else}<Base />{/if}
    </main>
  </div>
{/if}

<style>
  .center { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
  .muted { color: var(--text-2); }
  .err { color: var(--err); margin: 0; }
  .login {
    display: flex; flex-direction: column; gap: 14px; width: 320px;
    background: var(--panel); padding: 28px; border-radius: var(--r-card);
    border: 1px solid var(--border); box-shadow: var(--shadow-card);
  }
  .login h1 { margin: 0; font-family: var(--font-display); text-transform: uppercase; letter-spacing: .02em; }
  input {
    height: 44px; border-radius: var(--r-control); border: 1px solid var(--border);
    background: var(--surface); color: var(--text); padding: 0 12px; font: inherit;
  }
  .login button {
    height: 44px; border-radius: var(--r-control); border: none; cursor: pointer;
    background: var(--accent); color: #fff; font: inherit; font-weight: 600;
  }
  .login button:hover { background: var(--accent-hover); }
  .shell { display: grid; grid-template-columns: 252px 1fr; min-height: 100vh; }
  .content { padding: 28px; overflow: auto; }
</style>
