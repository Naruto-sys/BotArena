import { Component, lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ErrorInfo, FormEvent, ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { AuthSession, MatchJobStatus, Opponent, Replay, ScriptError, StrategyLanguage, UgcStrategyCard } from './contracts';
import { ReplayPlayer } from './ReplayPlayer';
import { MatchDiagnosticError, runMatch } from './matchApi';
import { StrategyHelp } from './StrategyHelp';
import { AuthPanel } from './AuthPanel';
import { UgcHub } from './UgcHub';
import { PveMap } from './PveMap';
import { login, ugcApi } from './ugcApi';
import { text } from './text';
import './style.css';

const StrategyEditor = lazy(() => import('./StrategyEditor'));

class AppGuard extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('BotArena UI crashed', error, info); }
  render() {
    if (!this.state.error) return this.props.children;
    return <main className="fatal-screen"><section className="panel"><h1>Интерфейс не смог продолжить работу</h1><p>{this.state.error.message}</p><button className="primary" onClick={() => location.reload()}>Перезагрузить BotArena</button></section></main>;
  }
}

const example = `function tick({ self, enemy }) {
  const { x, y } = self.position;
  // ${text.strategyComment}
  const waypoint = enemy?.position ??
    (y > 3.65 ? { x: 4.1, y: 3.45 } : { x: 12, y: 3.5 });
  const dx = waypoint.x - x;
  const dy = waypoint.y - y;
  const heading = Math.atan2(dy, dx);
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  const error = wrap(heading - self.bodyAngle);
  const turn = Math.max(-1, Math.min(1, error * 2));
  const far = !enemy || Math.hypot(dx, dy) > 5;
  const drive = far && Math.abs(error) < 0.55 ? 1 : 0;
  return {
    leftTrack: drive + turn,
    rightTrack: drive - turn,
    aimDirection: { x: dx, y: dy },
    shoot: !!enemy && self.canShoot &&
      Math.abs(wrap(heading - self.turretAngle)) < 0.045
  };
}`;

const examples = {
  javascript: example,
  python: `def tick(state):
    enemy = state["enemy"]
    if enemy is None:
        return {"leftTrack": 1, "rightTrack": 0.5}

    self_position = state["self"]["position"]
    target = enemy["position"]
    return {
        "aimDirection": {
            "x": target["x"] - self_position["x"],
            "y": target["y"] - self_position["y"],
        },
        "shoot": state["self"]["canShoot"],
    }
`,
};

type Workspace = 'learn' | 'match' | 'ugc';

function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    location.hash === '#ugc' || new URLSearchParams(location.search).has('share') ? 'ugc'
      : location.hash === '#arena' ? 'match' : 'learn');
  const [session, setSession] = useState<AuthSession>();
  const [savedStrategies, setSavedStrategies] = useState<UgcStrategyCard[]>([]);
  const [savedStrategyId, setSavedStrategyId] = useState('');
  const [languages, setLanguages] = useState<StrategyLanguage[]>(['javascript']);
  const [language, setLanguage] = useState<StrategyLanguage>('javascript');
  const [drafts, setDrafts] = useState(examples);
  const code = drafts[language];
  const updateCode = useCallback((value: string) => {
    setDrafts(previous => ({ ...previous, [language]: value }));
  }, [language]);
  const [opponents, setOpponents] = useState<Opponent[]>([]);
  const [opponentId, setOpponentId] = useState('');
  const [loading, setLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState<MatchJobStatus>();
  const activeRun = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [scriptError, setScriptError] = useState<ScriptError>();
  const [replay, setReplay] = useState<Replay>();

  useEffect(() => {
    const reload = () => { void ugcApi.session().then(setSession).catch(() => setSession({ authenticated: false })); };
    reload();
    window.addEventListener('botarena-balance-changed', reload);
    return () => window.removeEventListener('botarena-balance-changed', reload);
  }, []);

  useEffect(() => {
    if (!session?.authenticated) { setSavedStrategies([]); setSavedStrategyId(''); return; }
    const reload = () => { void ugcApi.mine().then(items => setSavedStrategies(items.filter(item => item.isActive))).catch(() => setSavedStrategies([])); };
    reload();
    window.addEventListener('botarena-strategies-changed', reload);
    return () => window.removeEventListener('botarena-strategies-changed', reload);
  }, [session]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/opponents', { signal: controller.signal });
        if (!response.ok) throw new Error();
        const choices: Opponent[] = await response.json();
        setOpponents(choices);
        setOpponentId(choices[0]?.id ?? '');
      } catch {
        if (!controller.signal.aborted) setError(text.opponentsUnavailable);
      }
    }
    void load();
    void fetch('/api/strategy-languages', { signal: controller.signal })
      .then(response => response.ok ? response.json() : ['javascript'])
      .then((available: StrategyLanguage[]) => setLanguages(available))
      .catch(() => { /* JavaScript is the default. */ });
    return () => {
      controller.abort();
      activeRun.current?.abort();
    };
  }, []);

  async function run(event: FormEvent) {
    event.preventDefault();
    if (!session?.authenticated) { login(); return; }
    if (activeRun.current) return;
    const controller = new AbortController();
    activeRun.current = controller;
    setLoading(true);
    setJobStatus(undefined);
    setError('');
    setScriptError(undefined);
    setReplay(undefined);
    try {
      const match = await runMatch(code, opponentId, language, controller.signal, setJobStatus);
      setReplay(match.replay);
      setScriptError(match.error ?? undefined);
    } catch (problem) {
      if (problem instanceof MatchDiagnosticError) {
        setScriptError(problem.diagnostic);
      } else if (!controller.signal.aborted) {
        setError(problem instanceof TypeError ? text.networkError :
          problem instanceof Error ? problem.message : text.matchError);
      }
    } finally {
      activeRun.current = null;
      setLoading(false);
      setJobStatus(undefined);
    }
  }

  async function chooseSavedStrategy(id: string) {
    setSavedStrategyId(id);
    if (!id) return;
    try {
      const strategy = await ugcApi.strategy(id);
      setLanguage(strategy.language);
      setDrafts(previous => ({ ...previous, [strategy.language]: strategy.code }));
      setError('');
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'Не удалось загрузить стратегию.');
    }
  }

  function opponentText(opponent: Opponent) {
    return Object.hasOwn(text.opponents, opponent.id)
      ? text.opponents[opponent.id as keyof typeof text.opponents] : opponent;
  }

  const opponent = opponents.find(item => item.id === opponentId);

  return (
    <main>
      <header className="app-header">
        <button className="brand-button" onClick={() => { setWorkspace('learn'); history.replaceState(null, '', '#learn'); }}><span className="brand-mark">B</span><span><b>{text.brand}</b><small>CODE · FIGHT · EVOLVE</small></span></button>
        <nav aria-label="Разделы">
          <button className={workspace === 'learn' ? 'active' : ''} onClick={() => { setWorkspace('learn'); history.replaceState(null, '', '#learn'); }}><span>◫</span> Обучение</button>
          <button className={workspace === 'match' ? 'active' : ''} onClick={() => { setWorkspace('match'); history.replaceState(null, '', '#arena'); }}><span>⌁</span> Арена</button>
          <button className={workspace === 'ugc' ? 'active' : ''} onClick={() => { setWorkspace('ugc'); history.replaceState(null, '', '#ugc'); }}><span>♧</span> Сообщество</button>
        </nav>
        <AuthPanel session={session} onChange={setSession} />
      </header>
      {workspace === 'learn' ? <PveMap session={session} /> : workspace === 'ugc' ? <UgcHub /> : <><section className="arena-heading"><div><p className="eyebrow">ПЕСОЧНИЦА</p><h1>Испытай стратегию на арене</h1><p>Выбери сохранённый алгоритм или напиши новый — справа сразу появится повтор боя.</p></div><span className="arena-status">● СИМУЛЯТОР ГОТОВ</span></section><div className="layout">
        <form className="panel editor" onSubmit={run}>
          <h1>{text.strategy}</h1>
          {!session?.authenticated && <div className="auth-required"><b>Для боя нужна авторизация</b><p>Войдите через Yandex ID, чтобы запускать матчи и использовать сохранённые стратегии.</p><button type="button" className="yandex-login" onClick={login}><b>Я</b> Войти через Яндекс</button></div>}
          {session?.authenticated && <label className="saved-strategy-picker">Сохранённая стратегия
            <select value={savedStrategyId} disabled={loading} onChange={event => void chooseSavedStrategy(event.target.value)}>
              <option value="">Код из редактора</option>
              {savedStrategies.map(strategy => <option key={strategy.id} value={strategy.id}>{strategy.name} · {strategy.language === 'python' ? 'Python' : 'JavaScript'}</option>)}
            </select>
          </label>}
          <div className="strategy-language">
            <span className="muted" id="strategy-label">{text.strategyLanguage(language)}</span>
            <select aria-label={text.languageLabel} value={language} disabled={loading}
              onChange={event => setLanguage(event.target.value as StrategyLanguage)}>
              {languages.map(item => <option key={item} value={item}>{text.languages[item]}</option>)}
            </select>
          </div>
          <Suspense fallback={<div className="code-editor" />}>
            <StrategyEditor key={language} language={language} initialCode={code} onChange={updateCode} />
          </Suspense>
          {error && <p role="alert" className="error-card">{error}</p>}
          {scriptError && (
            <div role="alert" className="error-card">
              <div className="error-heading">
                <strong>{text.diagnostic.title}</strong>
                <span>{text.replay[scriptError.botId]}</span>
              </div>
              <p>{scriptError.line == null ? scriptError.message :
                scriptError.tick == null ? text.diagnostic.load : text.diagnostic.tickFailure}</p>
              <dl className="error-details">
                {scriptError.line != null && <div><dt>{text.diagnostic.line}</dt><dd>{scriptError.line}</dd></div>}
                {scriptError.column != null && <div><dt>{text.diagnostic.column}</dt><dd>{scriptError.column}</dd></div>}
                {scriptError.tick != null && <div><dt>{text.diagnostic.tick}</dt><dd>{scriptError.tick}</dd></div>}
              </dl>
            </div>
          )}
          <StrategyHelp language={language} />
          <label htmlFor="opponent">{text.opponent}</label>
          <select id="opponent" value={opponentId} onChange={event => setOpponentId(event.target.value)}>
            {opponents.map(item => <option key={item.id} value={item.id}>{opponentText(item).name}</option>)}
          </select>
          {opponent && <p className="muted">{opponentText(opponent).description}</p>}
          <button className="primary" disabled={loading || !!session?.authenticated && (!opponentId || !code.trim() || code.length > 16384)}>
            {!session?.authenticated ? 'Войти для запуска матча' : loading ? text.working : text.start}
          </button>
          {code.length > 16384 && <p role="alert" className="error">{text.strategyTooLong}</p>}
          {jobStatus?.state === 'queued' && <p role="status">{text.queuePosition(jobStatus.position)}</p>}

        </form>
        <section className="panel replay">
          <h2>{text.arena}</h2>
          {replay ? <ReplayPlayer replay={replay} /> :
            <div className="empty">{text.emptyArena}</div>}
        </section>
      </div></>}
    </main>
  );
}

document.title = text.title;
document.documentElement.lang = text.language;
createRoot(document.getElementById('root')!).render(<AppGuard><App /></AppGuard>);
