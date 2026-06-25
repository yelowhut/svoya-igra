<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { gameStore, blockedUntil, buzzSeq, lastError, me } from '../lib/store.js';
  import { connect, joinAs, buzz, finalAction } from '../lib/socket.js';
  import { isValidTeamName } from '../lib/teamName.js';
  import Buzzer from '../lib/Buzzer.svelte';
  import { answerSecondsLeft, answerLow, finalSecondsLeft, finalLow } from '../lib/answerTimer.js';
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
  // Текущий счёт: сортировка по убыванию очков, своя команда помечена
  $: scoreRows = [...(state?.teams ?? [])]
    .sort((a: any, b: any) => b.score - a.score)
    .map((t: any) => ({ id: t.id, name: t.name, score: t.score, me: t.id === resolvedTeamId }));
  $: winner = scoreRows.length ? scoreRows[0] : null;

  // ── Финал: вычисления ────────────────────────────────────────────────────
  $: myTeamId = $me?.teamId ?? resolvedTeamId;
  $: final = state?.final ?? null;
  $: finalThemes = (state?.finalThemes ?? []) as { id: string; name: string }[];
  $: finalQuestion = state?.finalQuestion ?? null;
  $: captains = state?.captains ?? {};
  $: iAmCaptain = !!(final && $me && captains[myTeamId] === $me.playerId);
  $: iParticipate = !!(final?.eliminationOrder?.includes(myTeamId));
  // Капитаном считаемся только если и капитан, и участвуем
  $: iAmActiveCaptain = iAmCaptain && iParticipate;
  $: myScore = state?.teams?.find((t: any) => t.id === myTeamId)?.score ?? 0;
  // Имена тем по id
  $: themeNameMap = Object.fromEntries(finalThemes.map((th: { id: string; name: string }) => [th.id, th.name]));
  // Мой ход в вычёркивании
  $: myEliminationTurn = final
    ? (final.eliminationOrder[final.eliminationTurnIndex] === myTeamId)
    : false;
  // Имя команды, чей сейчас ход вычёркивания
  $: eliminationTurnTeamId = final
    ? (final.eliminationOrder[final.eliminationTurnIndex] ?? null)
    : null;
  $: eliminationTurnName = eliminationTurnTeamId
    ? (state?.teams?.find((t: any) => t.id === eliminationTurnTeamId)?.name ?? '?')
    : null;
  // Ставка уже сделана
  $: myBetPlaced = !!(final?.betPlaced?.includes(myTeamId));
  // Ответ уже зафиксирован
  $: myAnswerLocked = !!(final?.answerLocked?.includes(myTeamId));
  // Моя строка в reveal
  $: myRevealRow = final
    ? (() => {
        const idx = (final.eliminationOrder as string[]).indexOf(myTeamId);
        if (idx < 0) return null;
        return {
          revealed: idx < final.revealIndex,
          bet: (final.bets as Record<string, number>)[myTeamId] ?? null,
          answerText: (final.answers as Record<string, { text: string; locked: boolean }>)[myTeamId]?.text ?? null,
        };
      })()
    : null;

  // ── Ставка (FINAL_BETTING) ──────────────────────────────────────────────
  let betAmount = '';
  $: betNum = parseInt(betAmount, 10);
  $: betValid = !isNaN(betNum) && betNum >= 0 && betNum <= myScore;

  function placeBet() {
    if (!betValid || myBetPlaced) return;
    finalAction('placeBet', { amount: betNum });
  }

  // ── Ответ (FINAL_QUESTION) ──────────────────────────────────────────────
  let answerText = '';
  let answerDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let answerInitialized = false;

  // Инициализируем текст ответа из store при входе в фазу (только один раз)
  $: if (state?.phase === 'FINAL_QUESTION' && !answerInitialized && iAmActiveCaptain) {
    const stored = (final?.answers as Record<string, { text: string; locked: boolean }>)?.[myTeamId]?.text;
    if (stored) answerText = stored;
    answerInitialized = true;
  }
  // Сбрасываем при выходе из фазы + чистим debounce-таймер
  $: if (state?.phase !== 'FINAL_QUESTION') {
    answerInitialized = false;
    if (answerDebounceTimer) { clearTimeout(answerDebounceTimer); answerDebounceTimer = null; }
  }

  function onAnswerInput() {
    if (myAnswerLocked) return;
    if (answerDebounceTimer) clearTimeout(answerDebounceTimer);
    answerDebounceTimer = setTimeout(() => {
      finalAction('updateAnswer', { text: answerText });
    }, 1000);
  }

  function onAnswerBlur() {
    if (myAnswerLocked) return;
    if (answerDebounceTimer) { clearTimeout(answerDebounceTimer); answerDebounceTimer = null; }
    finalAction('updateAnswer', { text: answerText });
  }

  function lockAnswer() {
    if (myAnswerLocked) return;
    if (answerDebounceTimer) { clearTimeout(answerDebounceTimer); answerDebounceTimer = null; }
    finalAction('updateAnswer', { text: answerText });
    finalAction('lockAnswer');
  }

  onDestroy(() => {
    if (answerDebounceTimer) clearTimeout(answerDebounceTimer);
  });

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
    <div class="join">
      <h1 class="join-title">Вход в игру</h1>

      <input class="fld" placeholder="Фамилия" bind:value={lastName} />
      <input class="fld" placeholder="Имя"     bind:value={firstName} />

      <select class="fld" bind:value={teamId} class:dim={!!newTeamName.trim()}>
        <option value="">— выбрать команду —</option>
        {#each availableTeams as t}
          <option value={t.id}>{t.name}</option>
        {/each}
      </select>

      <div class="or-row">
        <span class="or-label">или создать:</span>
        <input
          class="fld"
          placeholder="Название команды"
          bind:value={newTeamName}
          on:input={() => { if (newTeamName.trim()) teamId = ''; }}
        />
      </div>

      {#if formHint}
        <p class="form-hint">{formHint}</p>
      {/if}
      {#if $lastError}
        <p class="form-err">{$lastError}</p>
      {/if}

      <button on:click={doJoin} class="primary join-btn">Войти</button>
    </div>

  {:else}
    <!-- ── C. PLAY VIEW ───────────────────────────────────────────────── -->
    <div class="play">
      <!-- Кто я: имя + команда (видно всегда) -->
      <div class="whoami">
        <span class="wa-name">{firstName} {lastName}</span>
        <span class="wa-team">{myTeamName}</span>
      </div>

      {#if state?.phase === 'GAME_END'}
        <div class="gameover">
          <h1 class="neon">🏆 Игра окончена</h1>
          {#if winner}<div class="go-winner">Победитель: {winner.name}</div>{/if}
        </div>

      {:else if state?.phase === 'FINAL_INTRO'}
        <!-- ── Финал: вступление ─────────────────────────────────────────── -->
        <div class="final-status">
          <h1 class="neon">ФИНАЛ</h1>
          {#if !iParticipate}
            <p class="final-sub">Ваша команда не участвует (счёт ≤ 0)</p>
          {:else}
            <p class="final-sub">Скоро финал — приготовьтесь!</p>
          {/if}
        </div>

      {:else if state?.phase === 'FINAL_ELIMINATION'}
        <!-- ── Финал: вычёркивание тем ──────────────────────────────────── -->
        {#if iAmActiveCaptain && myEliminationTurn}
          <div class="final-elim">
            <h2 class="final-section-title">Вычеркните тему</h2>
            <p class="final-sub">Оставшиеся темы:</p>
            <div class="elim-list">
              {#each (final?.themeIds ?? []) as tid (tid)}
                <button class="elim-btn ghost" on:click={() => finalAction('removeTheme', { themeId: tid })}>
                  {themeNameMap[tid] ?? tid}
                </button>
              {/each}
            </div>
          </div>
        {:else if iParticipate}
          <div class="final-status">
            <h2 class="final-section-title">Вычёркивание тем</h2>
            {#if eliminationTurnName}
              <p class="final-sub">Ходит: <span class="final-highlight">{eliminationTurnName}</span></p>
            {:else}
              <p class="final-sub">Идёт вычёркивание тем…</p>
            {/if}
          </div>
        {:else}
          <div class="final-status">
            <h2 class="final-section-title">Финал — вычёркивание тем</h2>
            <p class="final-sub">Ваша команда не участвует в финале</p>
          </div>
        {/if}

      {:else if state?.phase === 'FINAL_BETTING'}
        <!-- ── Финал: ставки ────────────────────────────────────────────── -->
        {#if iAmActiveCaptain}
          {#if myBetPlaced}
            <div class="final-status">
              <div class="final-ok-badge">✓ Ставка принята</div>
              <p class="final-sub">Ждём остальные команды…</p>
            </div>
          {:else}
            <div class="final-bet-form">
              <h2 class="final-section-title">Сделайте ставку</h2>
              <p class="final-sub">Ваш счёт: <span class="final-highlight">{myScore}</span></p>
              <p class="final-sub-small">Введите сумму от 0 до {myScore}</p>
              <div class="bet-input-row">
                <input
                  type="number"
                  min="0"
                  max={myScore}
                  bind:value={betAmount}
                  placeholder="0"
                  class="bet-input"
                />
                <button
                  class="primary"
                  on:click={placeBet}
                  disabled={!betValid}
                >
                  Сделать ставку
                </button>
              </div>
              {#if betAmount !== '' && !betValid}
                <p class="final-err">Ставка должна быть от 0 до {myScore}</p>
              {/if}
            </div>
          {/if}
        {:else if iParticipate}
          <div class="final-status">
            <h2 class="final-section-title">Ставки</h2>
            <p class="final-sub">Капитан вашей команды делает ставку…</p>
          </div>
        {:else}
          <div class="final-status">
            <h2 class="final-section-title">Ставки</h2>
            <p class="final-sub">Команды делают ставки на финальный вопрос</p>
          </div>
        {/if}

      {:else if state?.phase === 'FINAL_QUESTION'}
        <!-- ── Финал: вопрос и ответ ─────────────────────────────────────── -->
        <div class="final-q-wrap">
          {#if finalQuestion}
            <div class="final-question">
              <p class="final-q-text">{finalQuestion.prompt}</p>
              {#if finalQuestion.type === 'image' && finalQuestion.media}
                <img src={`/media/${state.packId}/${finalQuestion.media}`} alt="" class="final-q-img" />
              {/if}
              {#if finalQuestion.type === 'audio' && finalQuestion.media}
                <audio controls src={`/media/${state.packId}/${finalQuestion.media}`}></audio>
              {/if}
            </div>
          {/if}

          <!-- Таймер -->
          <div class="final-timer-row">
            <span class="final-timer" class:low={$finalLow}>{$finalSecondsLeft ?? '—'}</span>
            <span class="final-timer-cap">сек</span>
          </div>

          {#if iAmActiveCaptain}
            {#if myAnswerLocked}
              <div class="final-ok-badge">✓ Ответ зафиксирован</div>
            {:else}
              <div class="final-answer-form">
                <textarea
                  class="answer-textarea"
                  bind:value={answerText}
                  on:input={onAnswerInput}
                  on:blur={onAnswerBlur}
                  placeholder="Введите ваш ответ…"
                  rows="2"
                ></textarea>
                <button class="primary" on:click={lockAnswer}>
                  Готово
                </button>
              </div>
            {/if}
          {:else if iParticipate}
            <p class="final-sub">Капитан вводит ответ…</p>
          {:else}
            <p class="final-sub">Команды отвечают на финальный вопрос</p>
          {/if}
        </div>

      {:else if state?.phase === 'FINAL_REVEAL'}
        <!-- ── Финал: вскрытие ──────────────────────────────────────────── -->
        <div class="final-status">
          <h2 class="final-section-title">Финал — Вскрытие</h2>
          {#if myRevealRow}
            {#if myRevealRow.revealed}
              <div class="reveal-card">
                <div class="reveal-row-item">
                  <span class="reveal-label">Ваша ставка:</span>
                  <span class="reveal-val gold">{myRevealRow.bet ?? '—'}</span>
                </div>
                <div class="reveal-row-item">
                  <span class="reveal-label">Ваш ответ:</span>
                  <span class="reveal-val">{myRevealRow.answerText ?? '—'}</span>
                </div>
                <div class="reveal-row-item">
                  <span class="reveal-label">Счёт:</span>
                  <span class="reveal-val gold">{myScore}</span>
                </div>
              </div>
            {:else}
              <p class="final-sub">Ждём вскрытия вашего результата…</p>
            {/if}
          {:else}
            <p class="final-sub">Ваша команда не участвовала в финале</p>
          {/if}
        </div>

      {:else if myPick && !state?.currentPrompt}
        <h1 class="neon">ВЫБИРАЙТЕ ВОПРОС</h1>
      {:else if !state?.currentPrompt}
        <p class="waiting">{state?.phase === 'ROUND_END' ? 'Итоги раунда — ждём ведущего…' : 'Ждём ведущего…'}</p>
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

      <!-- Текущий счёт (всегда виден): своя команда выделена, сортировка по очкам -->
      {#if scoreRows.length}
        <div class="scores">
          {#each scoreRows as t (t.id)}
            <div class="score-row" class:me={t.me}>
              <span class="s-name">{t.name}</span>
              <span class="s-val">{t.score}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

</main>

<style>
  /* ── Форма входа (Студия) ── */
  .join { display: grid; gap: .75rem; max-width: 22rem; width: 100%; text-align: left; }
  .join-title { font-family: var(--font-display, 'Oswald'); font-weight: 700; text-transform: uppercase;
    letter-spacing: .04em; color: var(--accent, #7c5cff); text-align: center; margin: 0 0 .25rem; }
  .fld { width: 100%; box-sizing: border-box; height: 44px; padding: 0 14px;
    background: var(--surface, #15131f); border: 1px solid var(--border, #2a2740);
    border-radius: var(--r-control, 11px); color: var(--text, #f4f1ff);
    font: inherit; font-size: 16px; outline: none; transition: border-color .12s, box-shadow .12s; }
  .fld::placeholder { color: var(--text-3, #6f6a8a); }
  .fld:focus { border-color: var(--accent, #7c5cff); box-shadow: var(--glow-focus, 0 0 0 3px rgba(124,92,255,.2)); }
  select.fld { cursor: pointer; appearance: none;
    background-image: linear-gradient(45deg, transparent 50%, var(--text-3, #6f6a8a) 50%), linear-gradient(135deg, var(--text-3, #6f6a8a) 50%, transparent 50%);
    background-position: calc(100% - 18px) center, calc(100% - 13px) center; background-size: 5px 5px, 5px 5px; background-repeat: no-repeat;
    padding-right: 34px; }
  select.fld.dim { opacity: .4; }
  .or-row { display: flex; align-items: center; gap: .5rem; }
  .or-label { font-size: .85rem; color: var(--text-2, #9a93b8); white-space: nowrap; }
  .or-row .fld { flex: 1; }
  .form-hint { color: var(--gold, #f5c518); margin: 0; font-size: .85rem; }
  .form-err { color: var(--err, #ff4d4d); margin: 0; font-size: .85rem; }
  .join-btn { width: 100%; height: 46px; font-size: 16px; margin-top: .25rem; }

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
  .answer-circle { display: grid; place-items: center; gap: 8px; width: min(340px, 82vw); aspect-ratio: 1;
    border-radius: 50%; padding: 0 26px; box-sizing: border-box; text-align: center;
    background: radial-gradient(circle at 50% 45%, #43e9b0 0%, #1fd18e 60%, #149f6c 100%);
    box-shadow: 0 0 60px rgba(31,209,142,.5); color: #042; }
  .ac-title { font-family: var(--font-display, 'Oswald'); font-weight: 800; font-size: 30px; line-height: 1.05;
    letter-spacing: .01em; text-transform: uppercase; }
  .ac-num { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 68px; line-height: 1; color: #f5c518; }
  .ac-num.low { color: #ff4d4d; }
  .ac-cap { font-size: 15px; max-width: 240px; opacity: .9; line-height: 1.3; }
  .gameover { display: grid; gap: 10px; place-items: center; }
  .go-winner { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 22px; color: var(--gold, #f5c518); text-transform: uppercase; }
  /* Текущий счёт внизу экрана игрока */
  .scores { width: 100%; max-width: 22rem; display: grid; gap: 6px; margin-top: 4px; }
  .score-row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 14px; border-radius: 12px; background: rgba(255,255,255,.04);
    border: 1px solid var(--border, #2a2740); }
  .score-row.me { border-color: var(--accent, #7c5cff); background: rgba(124,92,255,.16);
    box-shadow: 0 0 0 1px var(--accent, #7c5cff); }
  .s-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score-row.me .s-name { color: #fff; }
  .s-val { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 20px;
    color: var(--gold, #f5c518); font-variant-numeric: tabular-nums; }
  .watch { display: grid; place-items: center; gap: 8px; text-align: center; }
  .w-lead { letter-spacing: .1em; text-transform: uppercase; font-size: 13px; opacity: .5; }
  .w-name { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 44px; text-transform: uppercase; }
  .w-time { font-size: 18px; color: #f5c518; }
  .w-time.low { color: #ff4d4d; }

  /* ══════════════ ФИНАЛ (player) ══════════════ */
  .final-status { display: grid; gap: 10px; place-items: center; text-align: center; padding: 20px; }
  .final-section-title {
    font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 26px;
    color: var(--accent, #7c5cff); text-transform: uppercase; letter-spacing: .04em; margin: 0;
  }
  .final-sub { font-size: 15px; color: var(--text-2, #9a93b8); margin: 0; }
  .final-sub-small { font-size: 13px; color: var(--text-2, #9a93b8); margin: 0; }
  .final-highlight { color: var(--gold, #f5c518); font-family: var(--font-display, 'Oswald'); font-weight: 700; }
  .final-ok-badge {
    padding: 12px 24px; border-radius: 14px;
    background: rgba(31,209,142,.12); border: 1px solid rgba(31,209,142,.5);
    color: #43e9b0; font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 20px;
  }
  .final-err { color: var(--err, #ff4d4d); font-size: 13px; margin: 0; }

  /* Вычёркивание */
  .final-elim { display: grid; gap: 14px; place-items: center; width: 100%; }
  .elim-list { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 22rem; }
  .elim-btn {
    width: 100%; padding: 10px 16px;
    font-family: var(--font-display, 'Oswald'); font-weight: 600; font-size: 16px;
    text-transform: uppercase; letter-spacing: .03em;
    border-radius: 12px; cursor: pointer;
    background: var(--surface, #15131f); border: 1px solid var(--border-accent, rgba(124,92,255,.3));
    color: var(--text, #f4f1ff); transition: background .12s, border-color .12s;
    height: auto;
  }
  .elim-btn:hover:not(:disabled) { background: var(--cell-hover, #211a3d); border-color: var(--accent, #7c5cff); }

  /* Ставка */
  .final-bet-form { display: grid; gap: 12px; place-items: center; width: 100%; max-width: 22rem; text-align: center; }
  .bet-input-row { display: flex; gap: 8px; width: 100%; }
  .bet-input {
    flex: 1; padding: 8px 12px; border-radius: var(--r-control, 11px);
    background: var(--surface, #15131f); border: 1px solid var(--border-accent, rgba(124,92,255,.3));
    color: var(--text, #f4f1ff); font-family: var(--font-display, 'Oswald'); font-size: 20px;
    font-weight: 700; text-align: center; outline: none;
    appearance: textfield; -moz-appearance: textfield;
  }
  .bet-input::-webkit-inner-spin-button,
  .bet-input::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  .bet-input:focus { border-color: var(--accent, #7c5cff); box-shadow: var(--glow-focus, 0 0 0 3px rgba(124,92,255,.2)); }

  /* Вопрос финала */
  .final-q-wrap { display: grid; gap: 16px; place-items: center; width: 100%; text-align: center; }
  .final-question { display: grid; gap: 10px; place-items: center; }
  .final-q-text { font-size: 1.3rem; line-height: 1.35; margin: 0; }
  .final-q-img { max-width: 80vw; max-height: 26vh; border-radius: 12px; }
  .final-timer-row { display: flex; align-items: baseline; gap: 6px; }
  .final-timer {
    font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 52px;
    line-height: 1; color: var(--accent, #7c5cff); transition: color .2s;
  }
  .final-timer.low { color: var(--err, #ff4d4d); }
  .final-timer-cap { font-size: 16px; color: var(--text-2, #9a93b8); }
  .final-answer-form { display: grid; gap: 10px; width: 100%; max-width: 22rem; }
  .answer-textarea {
    width: 100%; resize: vertical; min-height: 60px; padding: 10px 14px;
    border-radius: var(--r-control, 11px);
    background: var(--surface, #15131f); border: 1px solid var(--border-accent, rgba(124,92,255,.3));
    color: var(--text, #f4f1ff); font-family: var(--font-ui, 'Manrope'); font-size: 15px;
    line-height: 1.45; outline: none; box-sizing: border-box;
  }
  .answer-textarea:focus { border-color: var(--accent, #7c5cff); box-shadow: var(--glow-focus, 0 0 0 3px rgba(124,92,255,.2)); }

  /* Вскрытие (player view) */
  .reveal-card {
    display: grid; gap: 12px; padding: 18px 24px; border-radius: 16px;
    background: rgba(124,92,255,.08); border: 1px solid rgba(124,92,255,.35);
    width: 100%; max-width: 22rem; text-align: left;
  }
  .reveal-row-item { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .reveal-label { font-size: 13px; color: var(--text-2, #9a93b8); }
  .reveal-val { font-family: var(--font-display, 'Oswald'); font-weight: 700; font-size: 18px; color: var(--text, #f4f1ff); }
  .reveal-val.gold { color: var(--gold, #f5c518); }
</style>
