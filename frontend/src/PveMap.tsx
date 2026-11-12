import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AuthSession, PveAttemptResult, PveCourse, PveLeaderboard, PveLevel, StrategyLanguage } from './contracts';
import { ReplayPlayer } from './ReplayPlayer';
import { ArenaPreview } from './ArenaPreview';
import { scrollToPanel } from './scrollToPanel';
import { useMounted } from './useMounted';
import { text } from './text';
import { ugcApi } from './ugcApi';

const icons = ['⌁', '⌖', '↝', '◌', '✦'];
const StrategyEditor = lazy(() => import('./StrategyEditor'));

export function PveMap({ session }: { session: AuthSession | undefined }) {
  const mounted = useMounted();
  const [course, setCourse] = useState<PveCourse>();
  const [activeBlockId, setActiveBlockId] = useState('training');
  const [selected, setSelected] = useState<PveLevel>();
  const [language, setLanguage] = useState<StrategyLanguage>('javascript');
  const [code, setCode] = useState('');
  const [hintCount, setHintCount] = useState(0);
  const [result, setResult] = useState<PveAttemptResult>();
  const [leaderboard, setLeaderboard] = useState<PveLeaderboard>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [expanded, setExpanded] = useState(false);
  const workspace = useRef<HTMLElement>(null), arena = useRef<HTMLElement>(null), back = useRef<HTMLButtonElement>(null);
  const runEpoch = useRef(0), lastLevel = useRef<string | undefined>(undefined);
  const drafts = useRef<Record<string, Partial<Record<StrategyLanguage, string>>>>({});
  const selectedId = useRef(selected?.id); selectedId.current = selected?.id;
  const userId = session?.authenticated ? session.user.id : undefined;
  const owner = useRef(userId); owner.current = userId;

  useEffect(() => {
    runEpoch.current++;
    setSelected(undefined); setResult(undefined); setCourse(undefined); setError('');
    lastLevel.current = undefined; drafts.current = {};
    if (userId) void load();
  }, [userId]);

  useEffect(() => {
    setLeaderboard(undefined);
    if (!selected || selected.isTraining) return;
    void refreshLeaderboard(selected.id);
    const timer = setInterval(() => void refreshLeaderboard(selected.id), 5000);
    return () => clearInterval(timer);
  }, [selected?.id]);

  useEffect(() => {
    if (selected) { scrollToPanel(workspace.current); back.current?.focus({ preventScroll: true }); }
    else if (lastLevel.current) {
      const node = workspace.current?.querySelector<HTMLButtonElement>(`[data-level-id="${CSS.escape(lastLevel.current)}"]`);
      node?.focus({ preventScroll: true }); node?.scrollIntoView({ block: 'center' });
    }
  }, [selected?.id]);
  useEffect(() => { if (busy) scrollToPanel(arena.current); }, [busy]);

  async function load() {
    const requestedOwner = userId;
    try {
      const next = await ugcApi.pve();
      if (!mounted.current || owner.current !== requestedOwner) return;
      setCourse(next); setError('');
      if (!next.blocks.some(block => block.id === activeBlockId && !block.locked)) {
        setActiveBlockId(next.blocks.find(block => !block.locked && block.completed < block.total)?.id ?? 'training');
      }
    } catch (problem) {
      if (mounted.current && owner.current === requestedOwner) setError(problem instanceof Error ? problem.message : 'Не удалось загрузить PvE.');
    }
  }
  async function refreshLeaderboard(id: string) {
    try {
      const next = await ugcApi.pveLeaderboard(id);
      if (mounted.current && selectedId.current === id) setLeaderboard(next);
    } catch { /* Онлайн-сводка не должна мешать прохождению. */ }
  }
  function open(level: PveLevel) {
    if (level.locked) return;
    runEpoch.current++; lastLevel.current = level.id;
    setActiveBlockId(level.blockId); setSelected(level); setExpanded(false);
    setLanguage('javascript'); setCode(drafts.current[level.id]?.javascript ?? level.starterCode.javascript);
    setHintCount(0); setResult(undefined); setError(''); setNotice('');
  }
  function updateCode(value: string) {
    if (!selected) return;
    drafts.current[selected.id] = { ...drafts.current[selected.id], [language]: value }; setCode(value);
  }
  function changeLanguage(next: StrategyLanguage) {
    if (!selected || busy) return;
    setLanguage(next); setCode(drafts.current[selected.id]?.[next] ?? selected.starterCode[next]);
    setResult(undefined); setHintCount(0); setNotice(''); setError('');
  }
  function insertSolution() {
    if (!selected || busy) return;
    updateCode(selected.solutionCode[language]); setResult(undefined);
    setNotice('Правильный код вставлен. Запустите бой, чтобы проверить результат.');
  }
  async function attempt() {
    if (!selected || busy || !code.trim()) return;
    const epoch = ++runEpoch.current, requestedOwner = userId;
    setBusy(true); setExpanded(false); setError(''); setResult(undefined); setNotice('');
    try {
      const next = await ugcApi.attemptPve(selected.id, code, language);
      if (!mounted.current || owner.current !== requestedOwner) return;
      if (runEpoch.current === epoch) setResult(next);
      if (next.completed) {
        window.dispatchEvent(new Event('botarena-balance-changed')); await load();
        if (!selected.isTraining && selectedId.current === selected.id) await refreshLeaderboard(selected.id);
      }
    } catch (problem) {
      if (mounted.current && runEpoch.current === epoch) setError(problem instanceof Error ? problem.message : 'Не удалось запустить PvE-бой.');
    } finally { if (mounted.current) setBusy(false); }
  }
  function returnToMap() {
    runEpoch.current++; setSelected(undefined); setResult(undefined); setError(''); setNotice(''); setExpanded(false);
  }

  const activeBlock = course?.blocks.find(block => block.id === activeBlockId) ?? course?.blocks[0];
  const allLevels = useMemo(() => course?.blocks.flatMap(block => block.levels) ?? [], [course]);
  const nextLevel = allLevels.find(level => !level.completed && !level.locked);
  const following = selected && allLevels.find(level => level.order === selected.order + 1 && !level.locked);
  const selectedBlock = course?.blocks.find(block => block.id === selected?.blockId);
  const progress = course ? Math.round(course.completed / Math.max(1, course.total) * 100) : 0;

  if (!session) return <section className="learning-shell"><div className="learning-loading" /></section>;
  if (!session.authenticated) return <section className="learning-shell"><div className="learning-auth"><h1>От первой команды до чемпионской серии</h1><p>Рейтинговый PvE сохраняет награды и статистику в аккаунте. В гостевом режиме используйте учебные испытания.</p><button className="account-login" onClick={() => window.dispatchEvent(new CustomEvent('botarena-open-auth'))}>Войти или зарегистрироваться</button></div></section>;

  if (selected) return <section ref={workspace} className={`learning-shell pve-workspace${expanded ? ' pve-editor-expanded' : ''}`}>
    <div className="pve-workspace-heading"><button ref={back} type="button" onClick={returnToMap}>← К уровням PvE</button><span>Глава {selected.blockOrder} · {selected.stage} / {selectedBlock?.total ?? 5} · {selected.isTraining ? 'Учебный режим' : 'Рейтинговое испытание'}</span></div>
    <div className="layout">
      <form className="panel editor" onSubmit={event => { event.preventDefault(); void attempt(); }}>
        <div className="ux-editor-heading"><small>Стратегия / редактор</small><button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? 'Свернуть редактор' : 'Развернуть редактор'}</button></div>
        <h1>{selected.title}</h1>
        <details className="campaign-levels"><summary>Карта испытаний</summary>{selectedBlock?.levels.map(level => <button type="button" key={level.id} disabled={level.locked} aria-pressed={level.id === selected.id} className={`level-card${level.id === selected.id ? ' selected' : ''}${level.completed ? ' done' : ''}${level.locked ? ' locked' : ''}`} onClick={() => open(level)}><span className="level-order">{level.stage}</span><span className="level-body"><strong>{level.title}</strong><span className="muted">{level.completed ? 'Пройден' : level.locked ? 'Пройдите предыдущий уровень' : 'Открыт'}</span></span></button>)}</details>
        <div className="campaign-brief"><p>{selected.description}</p><p><strong>Цель: </strong>{selected.goal}</p><div className="pve-hints">{selected.hints.slice(0, hintCount).map(hint => <p className="muted" key={hint}>{hint}</p>)}{hintCount < selected.hints.length && <button type="button" onClick={() => setHintCount(value => value + 1)}>{hintCount ? 'Ещё подсказка' : 'Показать подсказку'}</button>}<button type="button" disabled={busy} onClick={insertSolution}>Вставить правильный код</button></div></div>
        <div className="strategy-language"><label htmlFor="pve-language">{text.chooseLanguage}</label><select id="pve-language" value={language} disabled={busy} onChange={event => changeLanguage(event.target.value as StrategyLanguage)}><option value="javascript">JavaScript</option><option value="python">Python</option></select></div>
        {notice && <p role="status" className="ugc-notice">{notice}</p>}
        <Suspense fallback={<div className="code-editor" />}><StrategyEditor key={`${selected.id}-${language}`} language={language} initialCode={code} onChange={updateCode} /></Suspense>
        <button className="primary" disabled={busy || !code.trim()}>{busy ? 'Проверяем алгоритм…' : 'Запустить матч'}</button>
        {error && <p role="alert" className="error-card">{error}</p>}
        {result && <div role="status" className={`pve-attempt-result ${result.completed ? 'success-card' : 'pve-retry'}`}><strong>{result.message}</strong><p>{result.completed ? `Награда: ◈ ${result.rewardAwarded || 'уже получена'}` : 'Посмотрите повтор, измените код и запустите проверку снова.'}</p>{result.completed && following && <button type="button" className="primary" onClick={() => open(following)}>Следующий уровень →</button>}</div>}
        {(result?.stats ?? selected.stats) && <details className="pve-personal-stats"><summary>Личная статистика</summary><Stats title="Личная сводка" stats={(result?.stats ?? selected.stats)!} /></details>}
      </form>
      <section ref={arena} className="panel replay"><div className="arena-panel-heading"><h2>Арена</h2><button type="button" onClick={returnToMap}>К уровням PvE</button></div>{busy && <p role="status" className="muted">Считаем бой… Можно вернуться к уровням, результат сохранится в профиле.</p>}{result ? <ReplayPlayer replay={result.match.replay} /> : <ArenaPreview arena={selected.arena} spawns={selected.spawns} />}</section>
    </div>
    {!selected.isTraining && <Leaderboard data={leaderboard} />}
  </section>;

  return <section ref={workspace} className="learning-shell">
    <header className="learning-header"><div><h1>{activeBlock?.title ?? 'Обучение'}</h1><p>{activeBlock?.description}</p></div><div className="course-progress"><div><strong>{course?.completed ?? 0}/{course?.total ?? 55}</strong><span>испытаний пройдено</span></div><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as CSSProperties}><b>{progress}%</b></div></div></header>
    {error && <p role="alert" className="error-card">{error}</p>}
    <div className="chapter-rail" aria-label="Главы PVE">{course?.blocks.map(block => <button key={block.id} disabled={block.locked} className={`${block.id === activeBlock?.id ? 'active' : ''} ${block.completed === block.total ? 'completed' : ''}`} onClick={() => setActiveBlockId(block.id)}><span>{block.locked ? '·' : block.completed === block.total ? '✓' : String(block.order).padStart(2, '0')}</span><div><b>{block.title}</b><small>{block.completed}/{block.total} {block.isTraining ? '· без рейтинга' : '· рейтинг'}</small></div></button>)}</div>
    <div className="learning-layout"><aside className="course-summary"><p className="eyebrow">ГЛАВА {activeBlock?.order}</p><h2>{activeBlock?.title}</h2><p>{activeBlock?.description}</p>{nextLevel && <button className="primary" onClick={() => open(nextLevel)}>Продолжить: {nextLevel.title}</button>}<div className="reward-note"><span>{activeBlock?.isTraining ? '◎' : '♜'}</span><div><b>{activeBlock?.isTraining ? 'Учебный режим' : 'Рейтинговые испытания'}</b><small>{activeBlock?.isTraining ? 'Здесь таблица лидеров отключена.' : 'Сравниваем время победы и полученный урон.'}</small></div></div></aside>
      <div className="level-map" aria-label="Карта подуровней">{activeBlock?.levels.map((level, index) => <div className={`level-stop stop-${index % 2} ${level.completed ? 'completed' : ''} ${level.locked ? 'locked' : ''}`} key={level.id}><button data-level-id={level.id} className="level-node" disabled={level.locked} onClick={() => open(level)} aria-label={`${level.title}${level.locked ? ', заблокирован' : ''}`}><span>{level.completed ? '✓' : level.locked ? '·' : icons[index]}</span></button><article><small>{level.isTraining ? 'УРОК' : 'ПОДУРОВЕНЬ'} {level.stage}/5 · <code>{level.command}</code></small><h3>{level.title}</h3><p>{level.description}</p>{level.stats?.bestDurationSeconds != null && <div className="level-mini-stats"><span>{level.stats.bestDurationSeconds} с</span><span>урон {level.stats.lowestDamageTaken}</span></div>}<footer><span>◈ {level.reward}</span><b>{level.completed ? 'Пройдено' : level.locked ? 'Закрыто' : 'Начать →'}</b></footer></article></div>)}</div>
    </div>
  </section>;
}

function Stats({ title, stats }: { title: string; stats: NonNullable<PveLevel['stats']> }) {
  return <section className="lesson-stats"><b>{title}</b><div><span><small>ЛУЧШЕЕ ВРЕМЯ</small>{stats.bestDurationSeconds == null ? '—' : `${stats.bestDurationSeconds} с`}</span><span><small>МИН. УРОН</small>{stats.lowestDamageTaken ?? '—'}</span><span><small>ПОПЫТОК</small>{stats.attempts}</span></div></section>;
}

function Leaderboard({ data }: { data: PveLeaderboard | undefined }) {
  return <section className="pve-leaderboard"><div><p className="eyebrow">ОНЛАЙН-СВОДКА</p><h3>Таблица лидеров</h3><span>Обновляется каждые 5 секунд</span></div>{!data ? <p className="muted">Загружаем результаты…</p> : !data.entries.length ? <p className="muted">Стань первым, кто пройдёт этот подуровень.</p> : <div className="leaderboard-table"><div className="leaderboard-head"><span>#</span><span>Пилот</span><span>Время</span><span>Урон</span><span>Попытки</span></div>{data.entries.map(entry => <div key={entry.user.id}><b>{entry.rank}</b><span>{entry.user.avatarUrl ? <img src={entry.user.avatarUrl} alt="" /> : <i>{entry.user.nickname?.[0] ?? '?'}</i>}@{entry.user.nickname}</span><strong>{entry.durationSeconds} с</strong><span>{entry.damageTaken}</span><span>{entry.attempts}</span></div>)}</div>}</section>;
}
