<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, blockedUntil, buzzSeq, lastError, me } from '../lib/store.js';
  import { connect, joinAs, buzz } from '../lib/socket.js';
  import { isValidTeamName } from '../lib/teamName.js';
  import Buzzer from '../lib/Buzzer.svelte';
  import { answerSecondsLeft, answerLow } from '../lib/answerTimer.js';
  import { fmtMs } from '../lib/format.js';

  // ── URL param ────────────────────────────────────────────────────────────
  const gameId = new URLSearchParams(location.search).get('game') ?? '';

  // ── Single-game state ────────────────────────────────────────────────────
  let exists = false;
  let joined = false;

  // form fields
  let firstName = '';
  let lastName  = '';
  let teamId    = '';        // pick existing
  let newTeamName = '';      // create new

  // pending join flag: we set this on submit so we can react to $me only once
  let pendingJoin = false;

  let formHint = '';

  let state: any = null;
  $: state = $gameStore;

  // ── Available teams (fetched via HTTP before join) ───────────────────────
  let availableTeams: { id: string; name: string }[] = [];

  // ── Derived play-view flags ──────────────────────────────────────────────
  $: resolvedTeamId = $me?.teamId ?? teamId;
  $: myTurn = state && state.answeringTeamId && state.answeringTeamId === resolvedTeamId;
  $: myPick = state && state.phase === 'PICKING' && state.pickingTeamId === resolvedTeamId;
  // позиция в очереди (1-based), если забаззил и не отвечает сейчас
  $: myQueuePos = (() => {
    const i = (state?.buzzQueue ?? []).findIndex((b: any) => b.teamId === resolvedTeamId);
    return i >= 0 ? i + 1 : null;
  })();
  $: answeringName = state?.teams?.find((t: any) => t.id === state?.answeringTeamId)?.name ?? '';
  $: myTeamName = state?.teams?.find((t: any) => t.id === resolvedTeamId)?.name ?? '';
  $: iBuzzed = myQueuePos !== null;
  // Результат моей команды по текущему вопросу (вердикт + дельта очков), если уже судили
  $: myResult = state?.questionResults?.[resolvedTeamId] ?? null;
  // Очередь нажатий с миллисекундами относительно сигнала «Открыть баззер»
  $: queueWithMs = (state?.buzzQueue ?? []).map((b: any, i: number) => ({
    pos: i + 1,
    name: state?.teams?.find((t: any) => t.id === b.teamId)?.name ?? '?',
    ms: Math.max(0, b.reaction),
    me: b.teamId === resolvedTeamId,
  }));

  // ── React to youAre for join confirmation + localStorage ────────────────
  $: if ($me && pendingJoin) {
    pendingJoin = false;
    localStorage.setItem('svoya:player', JSON.stringify({
      gameId,
      firstName: firstName.trim(),
      lastName:  lastName.trim(),
      teamId:    $me.teamId,
    }));
    joined = true;
  }

  // ── Break deadlock: if error during join, clear pendingJoin to show form ──
  $: if ($lastError && pendingJoin && !joined) pendingJoin = false;

  // ── Mount ────────────────────────────────────────────────────────────────
  onMount(async () => {
    lastError.set('');

    if (!gameId) {
      location.href = '/';   // публичный список игр теперь на лендинге
      return;
    }

    // Single-game flow
    connect();
    const r = await fetch(`/api/games/${gameId}/exists`).then(r => r.json()).catch(() => ({ exists: false }));
    exists = r.exists;
    if (!exists) return;

    // Fetch teams via HTTP so they're visible before joining
    availableTeams = await fetch(`/api/games/${gameId}/teams`).then(r => r.json()).catch(() => []);

    // Player resume
    const raw = localStorage.getItem('svoya:player');
    if (raw) {
      try {
        const stored = JSON.parse(raw) as { gameId: string; firstName: string; lastName: string; teamId: string };
        if (stored.gameId === gameId) {
          // Restore field values so they're available for localStorage update on youAre
          firstName = stored.firstName;
          lastName  = stored.lastName;
          teamId    = stored.teamId;
          pendingJoin = true;
          joinAs(gameId, 'player', stored.firstName, stored.lastName, stored.teamId);
          return;
        }
      } catch {
        // ignore malformed stored data
      }
    }
  });

  // ── Submit join form ──────────────────────────────────────────────────────
  function doJoin() {
    formHint = '';
    lastError.set('');
    const fn = firstName.trim();
    const ln = lastName.trim();

    if (!fn || !ln) {
      formHint = 'Введите фамилию и имя.';
      return;
    }

    const useNewTeam = newTeamName.trim().length > 0;

    if (useNewTeam) {
      if (!isValidTeamName(newTeamName)) {
        formHint = 'Недопустимое название команды (1–40 символов, буквы, цифры, пробел, . _ " -)';
        return;
      }
      pendingJoin = true;
      joinAs(gameId, 'player', fn, ln, '', newTeamName.trim());
    } else if (teamId) {
      pendingJoin = true;
      joinAs(gameId, 'player', fn, ln, teamId);
    } else {
      formHint = 'Выберите или создайте команду.';
    }
  }
</script>

<main style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:1rem">

  {#if !exists}
    <!-- ── B-notfound ──────────────────────────────────────────────────── -->
    <div>
      <h1 class="neon">Своя игра</h1>
      <p>Игра не найдена</p>
    </div>

  {:else if pendingJoin && !joined}
    <!-- ── B-pending: waiting for server confirmation ──────────────── -->
    <p>Подключение…</p>
    {#if $lastError}<p style="color:#ff6b6b">{$lastError}</p>{/if}

  {:else if !joined}
    <!-- ── B. JOIN FORM ───────────────────────────────────────────────── -->
    <div style="display:grid;gap:.75rem;max-width:22rem;width:100%">
      <h1 class="neon">Вход в игру</h1>

      <input placeholder="Фамилия" bind:value={lastName} />
      <input placeholder="Имя"     bind:value={firstName} />

      <select bind:value={teamId} style={newTeamName.trim() ? 'opacity:.4' : ''}>
        <option value="">— выбрать команду —</option>
        {#each availableTeams as t}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>

      <div style="display:flex;align-items:center;gap:.4rem">
        <span style="font-size:.85rem;opacity:.7">или создать:</span>
        <input
          placeholder="Название команды"
          bind:value={newTeamName}
          style="flex:1"
          on:input={() => { if (newTeamName.trim()) teamId = ''; }}
        />
      </div>

      {#if formHint}
        <p style="color:#f87;margin:0;font-size:.85rem">{formHint}</p>
      {/if}
      {#if $lastError}
        <p style="color:#f44;margin:0;font-size:.85rem">{$lastError}</p>
      {/if}

      <button on:click={doJoin} class="neon">Войти</button>
    </div>

  {:else}
    <!-- ── C. PLAY VIEW ───────────────────────────────────────────────── -->
    <div class="play">
      <!-- Кто я: имя + команда (видно всегда) -->
      <div class="whoami">
        <span class="wa-name">{firstName} {lastName}</span>
        <span class="wa-team">{myTeamName}</span>
      </div>

      {#if myPick && !state?.currentPrompt}
        <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
      {:else if !state?.currentPrompt}
        <p class="waiting">Ждём ведущего…</p>
      {:else}
        <!-- Вопрос виден всё время, пока он открыт (в т.ч. при баззере и ответе) -->
        <div class="prompt">
          <p class="prompt-text">{state.currentPrompt}</p>
          {#if state.currentType === 'image'}<img src={`/media/${state.packId}/${state.currentMedia}`} alt="" />{/if}
          {#if state.currentType === 'audio'}<audio controls src={`/media/${state.packId}/${state.currentMedia}`}></audio>{/if}
        </div>

        {#if myResult && !(state.phase === 'ANSWERING' && myTurn)}
          <!-- Вердикт моей команды: верно/неверно + изменение очков -->
          <div class="verdict" class:ok={myResult.correct}>
            <div class="v-title">{myResult.correct ? '✓ ВЕРНО!' : '✗ НЕВЕРНО'}</div>
            <div class="v-delta">{myResult.delta > 0 ? '+' : '−'}{Math.abs(myResult.delta)} очков</div>
          </div>
        {:else if state.phase === 'ANSWERING' && myTurn}
          <div class="answer-circle">
            <div class="ac-title">ВЫ ОТВЕЧАЕТЕ!</div>
            <div class="ac-num" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</div>
            <div class="ac-cap">секунд на ответ — говорите вслух!</div>
          </div>
        {:else if state.phase === 'ANSWERING'}
          <div class="watch">
            <div class="w-lead">ОТВЕЧАЕТ</div>
            <div class="w-name">{answeringName}</div>
            <div class="w-time" class:low={$answerLow}>осталось {$answerSecondsLeft ?? '—'} с</div>
          </div>
        {:else if state.phase === 'BUZZER_OPEN' && !iBuzzed}
          <Buzzer seq={$buzzSeq} blockedUntil={$blockedUntil} on:press={buzz} />
        {:else if state.phase === 'BUZZER_OPEN'}
          <div class="waitbuzz">✓ Вы нажали — ждём остальные команды</div>
        {:else if state.phase === 'BUZZER_ARMED'}
          <Buzzer armed blockedUntil={$blockedUntil} on:press={buzz} />
        {:else if state.phase === 'QUESTION'}
          <div class="getready">Приготовьтесь — баззер скоро откроется</div>
        {:else}
          <div class="getready">Вопрос завершён — ждём следующий</div>
        {/if}

        <!-- Порядок нажатий: Команда — задержка -->
        {#if queueWithMs.length}
          <div class="queue">
            {#each queueWithMs as q}
              <span class="q-item" class:me={q.me}>{q.pos}. {q.name} <b>{fmtMs(q.ms)}</b></span>
            {/each}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

</main>

<style>
  .play { display: grid; gap: 20px; place-items: center; width: 100%; max-width: 30rem; }
  .whoami { display: flex; flex-direction: column; gap: 2px; align-items: center; }
  .wa-name { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 20px; }
  .wa-team { font-size: 13px; color: var(--accent, #cdbcff); text-transform: uppercase; letter-spacing: .06em; }
  .waiting { color: var(--text-2, #9a93b8); }
  .prompt { display: grid; gap: 12px; place-items: center; }
  .prompt-text { font-size: 1.4rem; line-height: 1.35; margin: 0; }
  .prompt img { max-width: 80vw; max-height: 28vh; border-radius: 12px; }
  .verdict { display: grid; gap: 6px; place-items: center; padding: 22px 30px; border-radius: 20px;
    background: rgba(255,77,77,.12); border: 1px solid rgba(255,77,77,.45); }
  .verdict.ok { background: rgba(31,209,142,.12); border-color: rgba(31,209,142,.5); }
  .v-title { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 38px; line-height: 1; color: #ff6b6b; }
  .verdict.ok .v-title { color: #43e9b0; }
  .v-delta { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 26px; color: var(--gold, #f5c518); }
  .getready, .waitbuzz { padding: 18px 22px; border-radius: 16px; font-weight: 600;
    background: rgba(124,92,255,.10); border: 1px solid rgba(124,92,255,.3); color: #cdbcff; }
  .waitbuzz { background: rgba(31,209,142,.12); border-color: rgba(31,209,142,.4); color: #8ff0c8; }
  .queue { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .q-item { font-size: 13px; padding: 5px 10px; border-radius: 10px;
    background: rgba(255,255,255,.05); border: 1px solid var(--border, #2a2740); color: var(--text-2, #b7b0d0); }
  .q-item b { color: var(--gold, #f5c518); font-weight: 700; }
  .q-item.me { border-color: var(--accent, #7c5cff); color: #fff; background: rgba(124,92,255,.18); }
  .answer-circle { display: grid; place-items: center; gap: 6px; width: 300px; height: 300px; border-radius: 50%;
    padding: 0 32px; box-sizing: border-box; text-align: center;
    background: radial-gradient(circle at 50% 45%, #43e9b0 0%, #1fd18e 60%, #149f6c 100%);
    box-shadow: 0 0 60px rgba(31,209,142,.5); color: #042; }
  .ac-title { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 24px; line-height: 1.05; letter-spacing: .01em; }
  .ac-num { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 56px; line-height: 1; color: #f5c518; }
  .ac-num.low { color: #ff4d4d; }
  .ac-cap { font-size: 12px; max-width: 200px; opacity: .85; line-height: 1.25; }
  .watch { display: grid; place-items: center; gap: 8px; text-align: center; }
  .w-lead { letter-spacing: .1em; text-transform: uppercase; font-size: 13px; opacity: .5; }
  .w-name { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 44px; text-transform: uppercase; }
  .w-time { font-size: 18px; color: #f5c518; }
  .w-time.low { color: #ff4d4d; }
</style>
