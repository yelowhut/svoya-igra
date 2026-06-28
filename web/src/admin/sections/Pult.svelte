<script lang="ts">
  import { onMount } from 'svelte';
  import { gameStore, lastError } from '../../lib/store.js';
  import { joinAs, hostAction } from '../../lib/socket.js';
  import Matrix from '../../lib/Matrix.svelte';
  import Scoreboard from '../../lib/Scoreboard.svelte';
  import { workingGameId } from '../store.js';
  import { answerSecondsLeft, answerLow, finalSecondsLeft, finalLow } from '../../lib/answerTimer.js';
  import { fmtMs } from '../../lib/format.js';
  import { gameExists } from '../gameApi.js';
  import { navigate } from '../router.js';

  let state: any = null; $: state = $gameStore;
  let gameId: string | null = null; $: gameId = $workingGameId;
  let packRounds: any[] = [];
  let deltasInput: Record<string, string> = {};
  let auctionBids: Record<string, string> = {};

  onMount(async () => {
    if (!gameId) return;
    const ok = await gameExists(gameId).then(r => r.exists).catch(() => false);
    if (!ok) { workingGameId.set(null); return; }  // игра исчезла (БД пересоздана) — на лобби
    joinAs(gameId, 'host');
  });

  // загрузить структуру пака для матрицы, когда известен packId
  let loadedPackId = '';
  let packMissing = false;
  $: if (state?.packId && state.packId !== loadedPackId) {
    loadedPackId = state.packId;
    packMissing = false;
    // Пак мог быть удалён (снят с публикации), а игра на него ещё ссылается —
    // не валим пульт из-за 404: показываем уведомление, матрица пустая.
    fetch(`/api/packs/${state.packId}`)
      .then(r => r.ok ? r.json() : null)
      .then(p => { packRounds = p?.rounds ?? []; packMissing = !p; })
      .catch(() => { packRounds = []; packMissing = true; });
  }

  $: currentRound = packRounds[state?.roundIndex] ?? packRounds[0] ?? null;
  $: answeringTeam = state?.teams?.find((t: any) => t.id === state.answeringTeamId);
  $: auctionLeaderTeam = state?.teams?.find((t: any) => t.id === state.auction?.leaderTeamId);
  // Активные команды (есть подключённый игрок) и те, кто ещё не нажал в BUZZER_OPEN
  $: activeTeams = (state?.teams ?? []).filter((t: any) => (state?.players ?? []).some((p: any) => p.connected && p.teamId === t.id));

  // ── Финал: вспомогательные ──
  $: final = state?.final ?? null;
  $: finalThemes = (state?.finalThemes ?? []) as { id: string; name: string }[];
  $: finalQuestion = state?.finalQuestion ?? null;
  // Команды участвующие в финале (score > 0)
  $: finalParticipatingTeams = (state?.teams ?? []).filter((t: any) => t.score > 0) as { id: string; name: string; score: number }[];
  // Игроки команды (для выбора капитана)
  function playersOfTeam(teamId: string): { id: string; firstName: string; lastName: string }[] {
    return (state?.players ?? []).filter((p: any) => p.teamId === teamId);
  }
  function captainOfTeam(teamId: string): string | null {
    return state?.captains?.[teamId] ?? null;
  }
  function playerName(playerId: string): string {
    const p = (state?.players ?? []).find((p: any) => p.id === playerId);
    return p ? `${p.firstName} ${p.lastName}` : playerId;
  }
  // Имя команды-хода в вычёркивании
  $: eliminationTurnTeamId = final
    ? (final.eliminationOrder[final.eliminationTurnIndex] ?? null)
    : null;
  $: eliminationTurnName = eliminationTurnTeamId ? teamName(eliminationTurnTeamId) : null;
  // Строки для FINAL_REVEAL (ведущий видит все данные сразу)
  $: revealRows = final
    ? (final.eliminationOrder as string[]).map((tid: string, idx: number) => ({
        tid,
        name: teamName(tid),
        bet: (final.bets as Record<string, number>)[tid] ?? null,
        answerText: (final.answers as Record<string, { text: string; locked: boolean }>)[tid]?.text ?? null,
      }))
    : [];
  $: allRevealed = final ? final.revealIndex >= final.eliminationOrder.length : false;
  // Признак «следующий раунд — финал»: используем тип раунда из packRounds
  $: nextRoundIsFinal = packRounds[state?.roundIndex + 1]?.type === 'final';
  // Нет ни обычных следующих, ни финала (последний из нормальных уже пройден)
  $: hasNextNormalRound = state?.roundIndex != null
    && packRounds.some((r: any, i: number) => i > state.roundIndex && r.type !== 'final');
  // Просто — следующий после текущего по индексу
  $: nextNormalRoundIndex = (() => {
    if (state?.roundIndex == null) return null;
    for (let i = state.roundIndex + 1; i < packRounds.length; i++) {
      if (packRounds[i]?.type !== 'final') return i;
    }
    return null;
  })();
  $: pendingTeams = state?.phase === 'BUZZER_OPEN'
    ? activeTeams.filter((t: any) => !(state.buzzQueue ?? []).some((b: any) => b.teamId === t.id))
    : [];
  $: pendingNames = pendingTeams.map((t: any) => t.name).join(', ');

  function resetRound() {
    if (confirm('Сбросить раунд? Все клетки снова станут доступны (счёт команд сохранится).')) hostAction('resetRound');
  }

  function openBoard() {
    if (gameId) window.open(`/board?game=${encodeURIComponent(gameId)}`, '_blank');
  }

  function teamName(teamId: string): string { return state?.teams?.find((t: any) => t.id === teamId)?.name ?? teamId; }
  function adjustScore(teamId: string, delta: number) { hostAction('adjustScore', { teamId, delta }); }
  function adjustByDeltaInput(teamId: string) {
    const delta = parseInt(deltasInput[teamId] ?? '0', 10);
    if (!isNaN(delta) && delta !== 0) { adjustScore(teamId, delta); deltasInput[teamId] = ''; }
  }

  function onCaptainChange(teamId: string, e: Event) {
    const playerId = (e.currentTarget as HTMLSelectElement).value;
    if (playerId) hostAction('assignCaptain', { teamId, playerId });
  }

  async function endGame() {
    hostAction('endGame');           // сервер авто-деактивирует указатель
    workingGameId.set(null);
    navigate('lobby');
  }
</script>

<section class="pult">
  {#if !gameId}
    <div class="empty">Нет активной игры. Создайте или выберите игру в разделе «Лобби и команды».
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if !state}
    <p class="muted">Подключение к игре…</p>
  {:else if state.phase === 'GAME_END'}
    <h1 class="screen-title">Игра окончена</h1>
    <Scoreboard teams={state.teams} />
    <button class="primary" on:click={() => { workingGameId.set(null); navigate('lobby'); }}>К лобби</button>
  {:else if state.phase === 'LOBBY'}
    <div class="empty">Игра ещё в лобби. Перейдите в «Лобби и команды», чтобы начать раунд.
      <button class="primary" on:click={() => navigate('lobby')}>К лобби</button>
    </div>
  {:else if state.phase === 'ROUND_END'}
    <h1 class="screen-title">Итоги раунда {state.roundIndex + 1}</h1>
    <Scoreboard teams={state.teams} />
    <div class="round-end-actions">
      {#if nextNormalRoundIndex !== null}
        <button class="primary" on:click={() => hostAction('startRound', { roundIndex: nextNormalRoundIndex })}>Следующий раунд →</button>
      {/if}
      {#if nextRoundIsFinal}
        <button class="primary final-btn" on:click={() => hostAction('startFinal')}>Начать финал →</button>
      {/if}
      {#if nextNormalRoundIndex === null && !nextRoundIsFinal}
        <button class="primary" on:click={endGame}>Завершить игру</button>
      {/if}
    </div>
  <!-- ══════════════ ФИНАЛ — ветки для ведущего ══════════════ -->

  {:else if state.phase === 'FINAL_INTRO'}
    <div class="final-head">
      <h1 class="screen-title">ФИНАЛ</h1>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>
    <div class="final-section">
      <div class="panel-label">Темы финала</div>
      <div class="final-theme-list">
        {#each finalThemes as th}
          <div class="final-theme-chip">{th.name}</div>
        {/each}
      </div>
    </div>
    <div class="final-section">
      <div class="panel-label">Назначить капитанов</div>
      <div class="captains-grid">
        {#each finalParticipatingTeams as team}
          <div class="captain-row">
            <span class="captain-team">{team.name}</span>
            <select class="captain-select"
              value={captainOfTeam(team.id) ?? ''}
              on:change={(e) => onCaptainChange(team.id, e)}>
              <option value="">— выбрать капитана —</option>
              {#each playersOfTeam(team.id) as p}
                <option value={p.id}>{p.firstName} {p.lastName}</option>
              {/each}
            </select>
            {#if captainOfTeam(team.id)}
              <span class="captain-badge">✓ {playerName(captainOfTeam(team.id) ?? '')}</span>
            {/if}
          </div>
        {/each}
      </div>
    </div>
    <Scoreboard teams={state.teams} />
    <button class="primary" on:click={() => hostAction('finalBeginElimination')}>Начать вычёркивание →</button>

  {:else if state.phase === 'FINAL_ELIMINATION'}
    <div class="final-head">
      <h1 class="screen-title">ФИНАЛ — Вычёркивание</h1>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>
    {#if eliminationTurnName}
      <div class="elim-turn-info">Ход: <strong class="elim-turn-name">{eliminationTurnName}</strong></div>
    {:else}
      <div class="elim-turn-info">Вычёркивание завершено</div>
    {/if}
    <div class="final-section">
      <div class="panel-label">Темы (вычеркнутые — серым)</div>
      <div class="final-theme-list">
        {#each finalThemes as th}
          {@const active = (final?.themeIds ?? []).includes(th.id)}
          <div class="final-theme-chip" class:theme-elim={!active}>{th.name}</div>
        {/each}
      </div>
    </div>
    <Scoreboard teams={state.teams} />

  {:else if state.phase === 'FINAL_BETTING'}
    <div class="final-head">
      <h1 class="screen-title">ФИНАЛ — Ставки</h1>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>
    <div class="final-section panel">
      <div class="panel-label">Статус ставок команд</div>
      {#each finalParticipatingTeams as team}
        {@const placed = (final?.betPlaced ?? []).includes(team.id)}
        <div class="bet-status-row" class:bet-done={placed}>
          <span class="bet-team-name">{team.name}</span>
          <span class="bet-indicator">{placed ? '✓ Ставка сделана' : '…ждём'}</span>
        </div>
      {/each}
    </div>
    <Scoreboard teams={state.teams} />

  {:else if state.phase === 'FINAL_QUESTION'}
    <div class="final-head">
      <h1 class="screen-title">ФИНАЛ — Вопрос</h1>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
    </div>
    <div class="cols">
      <div class="left">
        {#if finalQuestion}
          <div class="qcard">
            <div class="qtext">{finalQuestion.prompt}</div>
            {#if finalQuestion.type === 'image' && finalQuestion.media}
              <img src={`/media/${state.packId}/${finalQuestion.media}`} alt="" class="final-q-img" />
            {/if}
            {#if finalQuestion.type === 'audio' && finalQuestion.media}
              <audio controls src={`/media/${state.packId}/${finalQuestion.media}`}></audio>
            {/if}
            {#if state.finalReferenceAnswer}
              <div class="answer">Эталон: {state.finalReferenceAnswer}</div>
            {/if}
          </div>
        {/if}
      </div>
      <div class="right">
        <div class="panel">
          <div class="answering-banner">Финальный таймер</div>
          <div class="timer-row">
            <span class="timer-badge" class:low={$finalLow}>{$finalSecondsLeft ?? '—'}</span>
            <span class="timer-cap">секунд на ответ.</span>
          </div>
          <div class="timer-ctl">
            {#if final?.answerPausedRemainingMs != null}
              <button class="ghost" on:click={() => hostAction('finalTimerResume')}>▶ Продолжить</button>
            {:else}
              <button class="ghost" on:click={() => hostAction('finalTimerPause')}>⏸ Пауза</button>
            {/if}
            <button class="ghost" on:click={() => hostAction('finalTimerReset')}>↻ Сброс</button>
          </div>
        </div>
        <div class="panel">
          <div class="panel-label">Готовность команд</div>
          {#each finalParticipatingTeams as team}
            {@const locked = (final?.answerLocked ?? []).includes(team.id)}
            <div class="ready-row" class:ready-done={locked}>
              <span>{team.name}</span>
              {#if locked}<span class="ready-badge">✓ готов</span>{/if}
            </div>
          {/each}
        </div>
      </div>
    </div>

  {:else if state.phase === 'FINAL_REVEAL'}
    <div class="final-head">
      <h1 class="screen-title">ФИНАЛ — Вскрытие</h1>
      {#if allRevealed}
        <button class="primary" on:click={endGame}>Завершить игру</button>
      {/if}
    </div>
    {#if state.finalReferenceAnswer}
      <div class="ref-answer-bar">Эталон: <strong>{state.finalReferenceAnswer}</strong></div>
    {/if}
    <div class="reveal-list-host">
      {#each revealRows as row, idx}
        {@const judged = idx < (final?.revealIndex ?? 0)}
        {@const current = idx === (final?.revealIndex ?? 0)}
        <div class="reveal-row-host" class:judged={judged} class:current={current}>
          <div class="reveal-row-top">
            <span class="reveal-team-name">{row.name}</span>
            <span class="reveal-bet-label">Ставка: <strong class="gold-text">{row.bet ?? '—'}</strong></span>
          </div>
          <div class="reveal-answer-text">{row.answerText || '—'}</div>
          {#if judged}
            <!-- уже рассудили — результат виден в счёте -->
            <div class="reveal-judged">Рассмотрено</div>
          {:else if current}
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('finalJudge', { teamId: row.tid, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('finalJudge', { teamId: row.tid, correct: false })}>✕ Неверно</button>
            </div>
          {:else}
            <div class="reveal-hidden-host">Ожидает очереди</div>
          {/if}
        </div>
      {/each}
    </div>
    <Scoreboard teams={state.teams} />

  {:else}
    <!-- ЖИВАЯ ИГРА -->
    <div class="head">
      <h1 class="screen-title">{state.title}</h1>
      <span class="round-chip">Раунд {state.roundIndex + 1}</span>
      <span class="timer-chip">Ответ {state.answerTimerSec ?? 45} с</span>
      <button class="ghost" on:click={resetRound}>Сбросить раунд</button>
      <button class="ghost danger" on:click={endGame}>Завершить игру</button>
      <button class="ghost tv" on:click={openBoard}>📺 Открыть ТВ</button>
    </div>

    {#if packMissing}
      <div class="pack-missing">Пак этой игры удалён или снят с публикации — поле вопросов недоступно. Завершите игру и создайте новую на актуальном паке.</div>
    {/if}

    {#if state.phase === 'PICKING' && state.pickingTeamId}
      <div class="pick-banner">Выбирает: <strong>{teamName(state.pickingTeamId)}</strong></div>
    {/if}

    <div class="cols">
      <div class="left">
        <Matrix round={currentRound} usedQuestionIds={state?.usedQuestionIds ?? []}
          selectedId={state?.currentQuestionId}
          clickable={state?.phase === 'PICKING' || (state?.phase === 'QUESTION' && !state?.revealed)}
          on:select={(e) => hostAction('selectQuestion', e.detail)} />

        {#if state?.currentPrompt}
          <div class="qcard">
            <div class="qtext">{state.currentPrompt}</div>
            <div class="answer">Ответ: {state.currentAnswer}</div>
          </div>
        {/if}
      </div>

      <div class="right">
        {#if state?.buzzQueue?.length || state?.phase === 'BUZZER_OPEN'}
          <div class="panel">
            <div class="panel-label">Очередь нажатий · история</div>
            {#each state.buzzQueue ?? [] as entry, i}
              {@const res = state.questionResults?.[entry.teamId]}
              <div class="queue-row" class:answering={entry.teamId === state.answeringTeamId}>
                <span class="q-name">{i + 1}. {teamName(entry.teamId)}</span>
                <span class="q-ms">{fmtMs(Math.max(0, entry.reaction))}</span>
                <span class="q-verdict" class:ok={res?.correct} class:bad={res && !res.correct}>{res ? (res.correct ? '✓' : '✗') : ''}</span>
              </div>
            {/each}
            {#if state?.phase === 'BUZZER_OPEN'}
              {#if pendingTeams.length}
                <div class="q-pending">Ждём: {pendingNames}</div>
              {:else if activeTeams.length}
                <div class="q-pending ok">Все команды нажали — можно начинать ответы</div>
              {/if}
            {/if}
          </div>
        {/if}

        {#if state.currentSpecial === 'auction'}
          <div class="panel gold">
            <div class="panel-label">Аукцион</div>
            {#if state.auction}<div>Ставка: <strong>{state.auction.highestBid}</strong>{#if auctionLeaderTeam} — {auctionLeaderTeam.name}{/if}</div>{/if}
            {#each (state.teams ?? []) as team}
              <div class="bid-row">
                <span>{team.name}</span>
                <input type="number" min="0" bind:value={auctionBids[team.id]} />
                <button class="ghost" on:click={() => { const a = Number(auctionBids[team.id]); if (!isNaN(a)) hostAction('auctionBid', { teamId: team.id, amount: a }); }}>Ставка</button>
              </div>
            {/each}
            {#if state.auction?.leaderTeamId}
              <button class="primary" on:click={() => hostAction('auctionWon', { teamId: state.auction.leaderTeamId, amount: state.auction.highestBid })}>Победитель: {auctionLeaderTeam?.name ?? ''}</button>
            {/if}
          </div>
        {:else if state.currentSpecial === 'cat'}
          <div class="panel">
            <div class="panel-label">Кот в мешке — передать команде</div>
            {#each (state.teams ?? []) as team}
              {#if team.id !== state.pickingTeamId}
                <button class="ghost" on:click={() => hostAction('catAssign', { toTeamId: team.id })}>{team.name}</button>
              {/if}
            {/each}
          </div>
        {:else if state?.currentQuestionId}
          <div class="panel">
            {#if !state.revealed}
              <div class="flow-hint">Вопрос ещё не показан игрокам</div>
              <button class="primary" on:click={() => hostAction('reveal')}>Прочитать вопрос</button>
            {:else if state.phase === 'QUESTION'}
              <button class="primary" on:click={() => hostAction('arm')}>Приготовиться</button>
            {:else if state.phase === 'BUZZER_ARMED'}
              <div class="flow-hint">Игроки видят «приготовьтесь». Ранний жим = фальстарт.</div>
              <button class="primary" on:click={() => hostAction('open')}>Открыть баззер (GO)</button>
            {:else if state.phase === 'BUZZER_OPEN'}
              <button class="primary" on:click={() => hostAction('startAnswers')} disabled={!state.buzzQueue?.length}>Начать ответы досрочно</button>
            {/if}
            <button class="ghost" on:click={() => hostAction('closeQuestion')}>Закрыть вопрос</button>
          </div>
        {/if}

        {#if answeringTeam}
          <div class="panel">
            <div class="answering-banner">Отвечает {answeringTeam.name}</div>
            <div class="timer-row">
              <span class="timer-badge" class:low={$answerLow}>{$answerSecondsLeft ?? '—'}</span>
              <span class="timer-cap">секунд на ответ. На нуле ответ не засчитан — ход следующему в очереди.</span>
            </div>
            <div class="timer-ctl">
              {#if state.answerPausedRemainingMs != null}
                <button class="ghost" on:click={() => hostAction('timerResume')}>▶ Продолжить</button>
              {:else}
                <button class="ghost" on:click={() => hostAction('timerPause')}>⏸ Пауза</button>
              {/if}
              <button class="ghost" on:click={() => hostAction('timerReset')}>↻ Сброс</button>
            </div>
            <div class="judge">
              <button class="judge-yes" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: true })}>✓ Верно</button>
              <button class="judge-no" on:click={() => hostAction('judge', { teamId: answeringTeam.id, correct: false })}>✕ Неверно</button>
            </div>
          </div>
        {/if}

        <div class="panel">
          <div class="panel-label">Счёт · быстрая правка ±100</div>
          {#each (state.teams ?? []) as team}
            <div class="score-row" class:answering={team.id === state.answeringTeamId}>
              <span class="sname">{team.name}</span>
              <span class="sval">{team.score}</span>
              <button class="icon" on:click={() => adjustScore(team.id, -100)}>−100</button>
              <button class="icon" on:click={() => adjustScore(team.id, 100)}>+100</button>
              <input type="number" placeholder="Δ" bind:value={deltasInput[team.id]} />
              <button class="icon" on:click={() => adjustByDeltaInput(team.id)}>OK</button>
            </div>
          {/each}
        </div>

        <button class="ghost" on:click={() => hostAction('endRound')}>Конец раунда</button>
      </div>
    </div>

    {#if $lastError}
      <div class="err-bar"><span>{$lastError}</span><button on:click={() => lastError.set('')}>×</button></div>
    {/if}
  {/if}
</section>

<style>
  /* СТРУКТУРА. Двухколоночная плотная раскладка — выровнять по прототипу §5.6.
     Цвета/радиусы — из theme.css. */
  .pult { display: flex; flex-direction: column; gap: 16px; }
  .screen-title { font-family: var(--font-display); text-transform: uppercase; margin: 0; }
  .head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .pack-missing { background: #2d0a0a; border: 1px solid var(--err); color: var(--err);
    border-radius: var(--r-control); padding: 10px 14px; font-size: 14px; }
  .round-chip, .timer-chip { border: 1px solid var(--border); border-radius: var(--r-control); padding: 4px 10px; color: var(--text-2); font-size: 13px; }
  .timer-chip { color: var(--gold); }
  .cols { display: grid; grid-template-columns: 1fr 360px; gap: 16px; }
  @media (max-width: 900px) { .cols { grid-template-columns: 1fr; } }
  .left { display: flex; flex-direction: column; gap: 12px; }
  .right { display: flex; flex-direction: column; gap: 12px; }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; display: flex; flex-direction: column; gap: 8px; }
  .panel.gold { border-color: var(--gold); }
  .panel-label { color: var(--text-3); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; }
  .qcard { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card); padding: 16px; }
  .qtext { font-size: 22px; }
  .answer { margin-top: 10px; color: var(--gold); border: 1px dashed var(--gold); border-radius: var(--r-control); padding: 8px 12px; }
  .queue-row { padding: 6px 8px; border-radius: var(--r-control);
    display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 8px; }
  .queue-row.answering { background: var(--cell-hover); color: var(--text); font-weight: 700; }
  .q-name { text-align: left; }
  .q-ms { color: var(--gold); font-variant-numeric: tabular-nums; text-align: center; }
  .q-verdict { text-align: right; font-weight: 700; font-size: 16px; }
  .q-verdict.ok { color: var(--ok); }
  .q-verdict.bad { color: var(--err); }
  .q-pending { font-size: 12px; color: var(--text-2); padding: 4px 8px; }
  .q-pending.ok { color: var(--ok); }
  .flow-hint { font-size: 12px; color: var(--text-3); line-height: 1.4; }
  .answering-banner { color: var(--ok); font-family: var(--font-display); }
  .pick-banner { background: rgba(245,197,24,.08); border: 1px solid var(--border-accent);
    border-radius: var(--r-control); padding: 8px 14px; color: var(--text-2); font-size: 15px; }
  .pick-banner strong { color: var(--gold); font-family: var(--font-display); }
  .judge { display: flex; gap: 10px; }
  .judge-yes { flex: 1; background: var(--ok); color: #042; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .judge-no { flex: 1; background: var(--err); color: #fff; border: none; border-radius: var(--r-control); padding: 16px; font: inherit; font-weight: 700; font-size: 18px; cursor: pointer; }
  .score-row { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; }
  .score-row.answering { outline: 1px solid var(--border-accent); border-radius: var(--r-control); padding: 4px; }
  .sname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sval { color: var(--gold); min-width: 32px; text-align: right; font-variant-numeric: tabular-nums; }
  .score-row input { width: 50px; }
  .score-row .icon { padding: 6px 7px; }
  .bid-row { display: flex; align-items: center; gap: 6px; }
  input { height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; width: 72px; }
  .icon { background: transparent; border: 1px solid var(--border); border-radius: var(--r-control); color: var(--text-2); cursor: pointer; padding: 6px 10px; }
  .empty { background: var(--panel); border: 1px dashed var(--border); border-radius: var(--r-card); padding: 24px; color: var(--text-2); display: flex; flex-direction: column; gap: 12px; align-items: flex-start; }
  .muted { color: var(--text-2); }
  .err-bar { display: flex; gap: 10px; align-items: center; background: #2d0a0a; border: 1px solid var(--err); border-radius: var(--r-control); padding: 8px 12px; color: var(--err); }
  .err-bar button { margin-left: auto; background: none; border: none; color: var(--err); cursor: pointer; }
  .ghost.danger { border-color: var(--err); color: var(--err); }
  .ghost.tv { margin-left: auto; }
  .timer-row { display: flex; align-items: center; gap: 12px; }
  .timer-badge { flex: none; min-width: 52px; height: 52px; display: flex; align-items: center; justify-content: center;
    border-radius: 12px; background: rgba(245,197,24,.12); border: 1px solid rgba(245,197,24,.4);
    font-family: var(--font-display); font-weight: 700; font-size: 26px; color: var(--gold); }
  .timer-badge.low { background: rgba(255,77,77,.16); border-color: rgba(255,77,77,.55); color: var(--err); }
  .timer-cap { font-size: 12px; color: var(--text-2); line-height: 1.4; }
  .timer-ctl { display: flex; gap: 8px; }

  /* ══════════════ ФИНАЛ — пульт ══════════════ */
  .final-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .final-section { display: flex; flex-direction: column; gap: 10px; }
  .final-theme-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .final-theme-chip {
    background: var(--cell); border: 1px solid var(--border-accent);
    border-radius: var(--r-control); padding: 6px 14px;
    font-family: var(--font-display); font-weight: 600; font-size: 14px;
    text-transform: uppercase; letter-spacing: .03em;
  }
  .final-theme-chip.theme-elim {
    opacity: .3; color: var(--text-3); border-color: var(--border);
    text-decoration: line-through;
  }
  .captains-grid { display: flex; flex-direction: column; gap: 10px; }
  .captain-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .captain-team { font-family: var(--font-display); font-weight: 600; min-width: 120px; }
  .captain-select { height: 36px; border-radius: var(--r-control); border: 1px solid var(--border); background: var(--surface); color: var(--text); padding: 0 10px; font: inherit; min-width: 180px; }
  .captain-badge { font-size: 12px; color: var(--ok); border: 1px solid rgba(31,209,142,.3); border-radius: var(--r-control); padding: 3px 10px; }
  .elim-turn-info { font-size: 18px; color: var(--text-2); }
  .elim-turn-name { font-family: var(--font-display); font-weight: 700; color: var(--gold); }
  .bet-status-row { display: flex; align-items: center; justify-content: space-between; gap: 10px;
    padding: 8px 12px; border-radius: var(--r-control); border: 1px solid var(--border); }
  .bet-status-row.bet-done { border-color: var(--ok); }
  .bet-team-name { font-family: var(--font-display); font-weight: 600; }
  .bet-indicator { font-size: 13px; color: var(--text-2); }
  .bet-status-row.bet-done .bet-indicator { color: var(--ok); }
  .final-q-img { max-width: 100%; max-height: 240px; border-radius: var(--r-card); margin-top: 10px; }
  .ready-row { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 6px 10px; border-radius: var(--r-control); border: 1px solid var(--border); }
  .ready-row.ready-done { border-color: var(--ok); }
  .ready-badge { font-size: 12px; color: var(--ok); }
  .ref-answer-bar { background: rgba(245,197,24,.08); border: 1px dashed var(--gold); border-radius: var(--r-control);
    padding: 8px 14px; color: var(--gold); font-size: 14px; }
  .reveal-list-host { display: flex; flex-direction: column; gap: 10px; }
  .reveal-row-host { background: var(--panel); border: 1px solid var(--border); border-radius: var(--r-card);
    padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; opacity: .75; transition: opacity .2s; }
  .reveal-row-host.current { opacity: 1; border-color: var(--border-accent); }
  .reveal-row-host.judged { opacity: .5; }
  .reveal-row-top { display: flex; gap: 16px; flex-wrap: wrap; align-items: baseline; justify-content: space-between; }
  .reveal-team-name { font-family: var(--font-display); font-weight: 700; font-size: 18px; }
  .reveal-bet-label { font-size: 13px; color: var(--text-2); }
  .gold-text { color: var(--gold); font-variant-numeric: tabular-nums; }
  .reveal-answer-text { color: var(--text-accent); font-family: var(--font-display); font-weight: 700;
    font-size: 28px; line-height: 1.2; text-align: center; padding: 8px 4px;
    word-break: break-word; }
  .reveal-hidden-host { color: var(--text-4); letter-spacing: .15em; }
  .reveal-judged { font-size: 12px; color: var(--text-3); }
  .round-end-actions { display: flex; gap: 10px; flex-wrap: wrap; }
  .final-btn { background: var(--gold); color: #0a0800; border-color: transparent; }
  .final-btn:hover:not(:disabled) { background: #e6b400; }
</style>
