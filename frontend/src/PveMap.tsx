import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AuthSession, PveAttemptResult, PveBlock, PveCourse, PveLeaderboard, PveLevel, StrategyLanguage } from './contracts';
import { ReplayPlayer } from './ReplayPlayer';
import { ugcApi } from './ugcApi';

const icons = ['⌁', '⌖', '↝', '◌', '✦'];
const StrategyEditor = lazy(() => import('./StrategyEditor'));

export function PveMap({ session }: { session: AuthSession | undefined }) {
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
  const [celebratingId, setCelebratingId] = useState<string>();
  const [replayFinished, setReplayFinished] = useState(false);

  useEffect(() => {
    if (!session?.authenticated) { setCourse(undefined); return; }
    void load();
  }, [session?.authenticated]);

  useEffect(() => {
    if (!selected || selected.isTraining) { setLeaderboard(undefined); return; }
    void refreshLeaderboard(selected.id);
    const timer = setInterval(() => void refreshLeaderboard(selected.id), 5000);
    return () => clearInterval(timer);
  }, [selected?.id]);

  async function load() {
    try {
      const next = await ugcApi.pve(); setCourse(next); setError('');
      if (!next.blocks.some(block => block.id === activeBlockId && !block.locked)) {
        setActiveBlockId(next.blocks.find(block => !block.locked && block.completed < block.total)?.id ?? 'training');
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось загрузить PVE.'); }
  }
  async function refreshLeaderboard(id: string) {
    try { setLeaderboard(await ugcApi.pveLeaderboard(id)); }
    catch { /* Онлайн-сводка не должна мешать прохождению. */ }
  }
  function open(level: PveLevel) {
    if (level.locked) return;
    setSelected(level); setLanguage('javascript'); setCode(level.starterCode.javascript);
    setHintCount(0); setResult(undefined); setReplayFinished(false); setError(''); setNotice('');
  }
  function changeLanguage(next: StrategyLanguage) {
    if (!selected) return;
    setLanguage(next); setCode(selected.starterCode[next]); setResult(undefined); setReplayFinished(false); setHintCount(0); setNotice('');
  }
  function insertSolution() {
    if (!selected) return;
    setCode(selected.solutionCode[language]); setResult(undefined); setReplayFinished(false);
    setNotice('Правильный код вставлен. Запусти бой, чтобы проверить результат.');
  }
  async function attempt() {
    if (!selected) return;
    setBusy(true); setError(''); setResult(undefined); setReplayFinished(false); setNotice('');
    try {
      const next = await ugcApi.attemptPve(selected.id, code, language);
      setResult(next);
      if (next.completed) {
        window.dispatchEvent(new Event('botarena-balance-changed'));
        await load();
        if (!selected.isTraining) await refreshLeaderboard(selected.id);
      }
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось запустить PVE-бой.'); }
    finally { setBusy(false); }
  }
  function returnToMap() {
    setSelected(undefined); setResult(undefined);
  }
  function finishReplay() {
    setReplayFinished(true);
    if (selected && result?.completed) {
      setCelebratingId(selected.id);
      window.setTimeout(() => setCelebratingId(undefined), 2200);
    }
  }

  const activeBlock = course?.blocks.find(block => block.id === activeBlockId) ?? course?.blocks[0];
  const progress = course ? Math.round(course.completed / course.total * 100) : 0;
  const nextLevel = useMemo(() => course?.blocks.flatMap(block => block.levels).find(level => !level.completed && !level.locked), [course]);

  if (!session) return <section className="learning-shell"><div className="learning-loading" /></section>;
  if (!session.authenticated) return <section className="learning-shell"><div className="learning-auth"><span className="learning-orb">⌁</span><h1>От первой команды до чемпионской серии</h1><p>Рейтинговый PvE сохраняет награды и статистику в аккаунте. В гостевом режиме используйте учебные испытания — их можно запускать без входа, но прогресс не сохранится.</p><button className="account-login" onClick={() => window.dispatchEvent(new CustomEvent('botarena-open-auth'))}>Войти или зарегистрироваться</button></div></section>;

  return <section className="learning-shell">
    <header className="learning-header"><div><h1>{activeBlock?.title ?? 'Обучение'}</h1><p>{activeBlock?.description}</p></div><div className="course-progress"><div><strong>{course?.completed ?? 0}/{course?.total ?? 55}</strong><span>испытаний пройдено</span></div><div className="progress-ring" style={{ '--progress': `${progress * 3.6}deg` } as CSSProperties}><b>{progress}%</b></div></div></header>
    {error && !selected && <p className="error-card">{error}</p>}
    <div className="chapter-rail" aria-label="Главы PVE">{course?.blocks.map(block => <button key={block.id} disabled={block.locked} className={`${block.id === activeBlock?.id ? 'active' : ''} ${block.completed === block.total ? 'completed' : ''}`} onClick={() => setActiveBlockId(block.id)}><span>{block.locked ? '·' : block.completed === block.total ? '✓' : String(block.order).padStart(2, '0')}</span><div><b>{block.title}</b><small>{block.completed}/{block.total} {block.isTraining ? '· без рейтинга' : '· рейтинг'}</small></div></button>)}</div>
    <div className="learning-layout">
      <aside className="course-summary"><p className="eyebrow">ГЛАВА {activeBlock?.order}</p><h2>{activeBlock?.title}</h2><p>{activeBlock?.description}</p>{nextLevel && <button className="primary" onClick={() => { setActiveBlockId(nextLevel.blockId); open(nextLevel); }}>Продолжить: {nextLevel.title}</button>}<div className="reward-note"><span>{activeBlock?.isTraining ? '◎' : '♜'}</span><div><b>{activeBlock?.isTraining ? 'Учебный режим' : 'Рейтинговые испытания'}</b><small>{activeBlock?.isTraining ? 'Здесь таблица лидеров отключена.' : 'Сравниваем время победы и полученный урон.'}</small></div></div></aside>
      <div className="level-map" aria-label="Карта подуровней">
        {activeBlock?.levels.map((level, index) => <div className={`level-stop stop-${index % 2} ${level.completed ? 'completed' : ''} ${level.locked ? 'locked' : ''} ${celebratingId === level.id ? 'celebrating' : ''}`} key={level.id}>
          <button className="level-node" disabled={level.locked} onClick={() => open(level)} aria-label={`${level.title}${level.locked ? ', заблокирован' : ''}`}><span>{level.completed ? '✓' : level.locked ? '·' : icons[index]}</span></button>
          <article><small>{level.isTraining ? 'УРОК' : 'ПОДУРОВЕНЬ'} {level.stage}/5 · <code>{level.command}</code></small><h3>{level.title}</h3><p>{level.description}</p>{level.stats?.bestDurationSeconds != null && <div className="level-mini-stats"><span>⏱ {level.stats.bestDurationSeconds} с</span><span>◆ урон {level.stats.lowestDamageTaken}</span></div>}<footer><span>◈ {level.reward}</span><b>{level.completed ? 'Пройдено' : level.locked ? 'Закрыто' : 'Начать →'}</b></footer></article>
        </div>)}
      </div>
    </div>

    {selected && <div className="lesson-overlay"><section className="lesson-dialog">
      <header className="lesson-dialog-header"><button className="lesson-back" onClick={() => setSelected(undefined)}>← Карта</button><span>{selected.isTraining ? 'Урок' : 'Подуровень'} {selected.stage} из 5</span><button className="lesson-close" aria-label="Закрыть урок" onClick={() => setSelected(undefined)}>×</button></header>
      <div className="lesson-main"><div className="lesson-copy"><p className="eyebrow">{selected.isTraining ? 'КОМАНДА' : `ГЛАВА ${selected.blockOrder}`} · {selected.command}</p><h2>{selected.title}</h2><p>{selected.description}</p><div className="mission-card"><span>ЦЕЛЬ БОЯ</span><b>{selected.goal}</b></div>{selected.stats && <Stats title="Личная сводка" stats={selected.stats} />}<div className="hint-stack">{selected.hints.slice(0, hintCount).map((hint, index) => <p key={hint}><span>{index + 1}</span>{hint}</p>)}{hintCount < selected.hints.length && <button onClick={() => setHintCount(value => value + 1)}>💡 {hintCount ? 'Ещё подсказка' : 'Показать подсказку'}</button>}<button className="solution-button" onClick={insertSolution}>⌘ Вставить правильный код</button></div></div>
        <div className="lesson-workspace"><div className="lesson-toolbar"><span>РЕДАКТОР РЕШЕНИЯ</span><select value={language} disabled={busy} onChange={event => changeLanguage(event.target.value as StrategyLanguage)}><option value="javascript">JavaScript</option><option value="python">Python</option></select></div>{notice && <p className="ugc-notice">{notice}</p>}<div className="lesson-editor"><Suspense fallback={<div className="code-editor" />}><StrategyEditor key={`${selected.id}-${language}-${code === selected.solutionCode[language] ? 'solution' : 'draft'}`} language={language} initialCode={code} onChange={setCode} /></Suspense></div><button className="lesson-run" disabled={busy || !code.trim()} onClick={() => void attempt()}>{busy ? 'Проверяем алгоритм…' : '▶ Запустить PVE-бой'}</button>{error && <p className="error-card">{error}</p>}</div>
      </div>
      {result && <div className={`lesson-result ${result.completed ? 'success' : 'retry'}`}>{result.completed && replayFinished && <div className="victory-burst" aria-hidden="true">{Array.from({ length: 14 }, (_, index) => <i key={index} style={{ '--piece': index } as CSSProperties} />)}<strong>ПОБЕДА</strong></div>}<div className="result-copy"><span>{result.completed ? '✓' : '↻'}</span><div><h3>{result.message}</h3><p>{result.completed ? `Награда: ◈ ${result.rewardAwarded || 'уже получена'} · ${result.stats.lastDurationSeconds} с · урон ${result.stats.lastDamageTaken}` : 'Посмотри повтор, измени код и запусти проверку снова.'}</p></div>{result.completed && <button className="primary" onClick={returnToMap}>Продолжить</button>}</div><ReplayPlayer replay={result.match.replay} onComplete={finishReplay} /></div>}
      {!selected.isTraining && <Leaderboard data={leaderboard} />}
    </section></div>}
    {celebratingId && <div className="campaign-celebration" aria-live="polite"><div>✓</div><strong>Уровень пройден!</strong>{Array.from({ length: 18 }, (_, index) => <i key={index} style={{ '--piece': index } as CSSProperties} />)}</div>}
  </section>;
}

function Stats({ title, stats }: { title: string; stats: NonNullable<PveLevel['stats']> }) {
  return <section className="lesson-stats"><b>{title}</b><div><span><small>ЛУЧШЕЕ ВРЕМЯ</small>{stats.bestDurationSeconds == null ? '—' : `${stats.bestDurationSeconds} с`}</span><span><small>МИН. УРОН</small>{stats.lowestDamageTaken ?? '—'}</span><span><small>ПОПЫТОК</small>{stats.attempts}</span></div></section>;
}

function Leaderboard({ data }: { data: PveLeaderboard | undefined }) {
  return <section className="pve-leaderboard"><div><p className="eyebrow">ОНЛАЙН-СВОДКА</p><h3>Таблица лидеров</h3><span>Обновляется каждые 5 секунд</span></div>{!data ? <p className="muted">Загружаем результаты…</p> : !data.entries.length ? <p className="muted">Стань первым, кто пройдёт этот подуровень.</p> : <div className="leaderboard-table"><div className="leaderboard-head"><span>#</span><span>Пилот</span><span>Время</span><span>Урон</span><span>Попытки</span></div>{data.entries.map(entry => <div key={entry.user.id}><b>{entry.rank}</b><span>{entry.user.avatarUrl ? <img src={entry.user.avatarUrl} alt="" /> : <i>{entry.user.nickname?.[0] ?? '?'}</i>}@{entry.user.nickname}</span><strong>{entry.durationSeconds} с</strong><span>{entry.damageTaken}</span><span>{entry.attempts}</span></div>)}</div>}</section>;
}
