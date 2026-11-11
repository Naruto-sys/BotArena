import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import type {
  AppMode,
  AuthSession,
  CampaignTrack,
  MatchJobStatus,
  Movement,
  Replay,
  ScriptError,
  StrategyLanguage,
  StrategyLogLine,
} from './contracts';
import { ArenaPreview } from './ArenaPreview';
import { botLabel, teamWon } from './botDisplay';
import { isLevelUnlocked, loadCompletedLevels, markLevelCompleted } from './campaignProgress';
import { wallOverlapsBot } from './mapGeometry';
import { LabArenaEditor } from './LabArenaEditor';
import { LabSettingsDialog } from './LabSettingsDialog';
import { ArenaModal } from './ArenaModal';
import {
  classicWalls,
  customBots,
  defaultLabSetup,
  layoutBots,
  loadLabSetup,
  saveLabSetup,
  type BehaviorPresetInfo,
  type LabSetup,
} from './labDraft';
import { MatchDiagnosticError, buildCustomMatchPayload, runMatch } from './matchApi';
import { StrategyHelpContent } from './StrategyHelp';
import { AuthPanel } from './AuthPanel';
import { ugcApi, type AuthNotice } from './ugcApi';
import { text } from './text';
import { Home, Workshop, LearningMap, SettingsDialog, SystemTour, type Page } from './PlatformPages';
import { platformText as ui } from './text';
import { loadStrategies, saveStrategies, type SavedStrategy } from './strategyLibrary';
import './style.css';
import './platform.css';

const PveMap = lazy(() => import('./PveMap').then(module => ({ default: module.PveMap })));
const UgcHub = lazy(() => import('./UgcHub').then(module => ({ default: module.UgcHub })));
const RoomsPanel = lazy(() => import('./RoomsPanel').then(module => ({ default: module.RoomsPanel })));
const StrategyEditor = lazy(() => import('./StrategyEditor'));
const ReplayPlayer = lazy(() => import('./ReplayPlayer').then(module => ({ default: module.ReplayPlayer })));

const quickDemoCode = `function tick({ self, enemy }) {
  if (!enemy) return { leftTrack: 0.4, rightTrack: -0.4 };
  const x = enemy.position.x - self.position.x;
  const y = enemy.position.y - self.position.y;
  return { aimDirection: { x, y }, shoot: self.canShoot };
}`;

function formatErrorSnippet(source: string, line?: number | null, column?: number | null) {
  if (line == null || line < 1) return '';
  const lines = source.split('\n');
  const index = line - 1;
  if (index >= lines.length) return '';
  const start = Math.max(0, index - 1);
  const end = Math.min(lines.length, index + 2);
  const width = String(end).length;
  const parts: string[] = [];
  for (let i = start; i < end; i += 1) {
    const marker = i === index ? '>' : ' ';
    parts.push(`${marker} ${String(i + 1).padStart(width, ' ')} | ${lines[i]}`);
    if (i === index && column != null && column > 0) {
      parts.push(`  ${''.padStart(width, ' ')} | ${' '.repeat(column - 1)}^`);
    }
  }
  return parts.join('\n');
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

const trackedExamples = {
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

const hoverExamples = {
  javascript: `function tick({ tick, self, enemy }) {
  // ${text.hoverExampleComment}
  if (tick < 10) return { thrust: { x: 0, y: -1 } };
  if (tick < 22) return { turn: 1 };

  const thrust = { x: -self.velocity.x * 1.4, y: -self.velocity.y * 1.4 };
  if (!enemy) return { thrust };
  return {
    thrust,
    aimDirection: { x: enemy.position.x - self.position.x, y: enemy.position.y - self.position.y },
    shoot: self.canShoot,
  };
}`,
  python: `def tick(state):
    # ${text.hoverExampleComment}
    if state["tick"] < 10:
        return {"thrust": {"x": 0, "y": -1}}
    if state["tick"] < 22:
        return {"turn": 1}

    self = state["self"]
    velocity = self["velocity"]
    action = {"thrust": {"x": -velocity["x"] * 1.4, "y": -velocity["y"] * 1.4}}
    enemy = state["enemy"]
    if enemy is not None:
        action["aimDirection"] = {
            "x": enemy["position"]["x"] - self["position"]["x"],
            "y": enemy["position"]["y"] - self["position"]["y"],
        }
        action["shoot"] = self["canShoot"]
    return action
`,
};

const wheeledExamples = {
  javascript: `function tick({ tick, self, enemy }) {
  const action = { throttle: 0.8, turn: tick < 18 ? -0.7 : 0.55 };
  if (enemy) {
    action.aimDirection = { x: enemy.position.x - self.position.x, y: enemy.position.y - self.position.y };
    action.shoot = self.canShoot;
  }
  return action;
}`,
  python: `def tick(state):
    action = {"throttle": 0.8, "turn": -0.7 if state["tick"] < 18 else 0.55}
    enemy = state["enemy"]
    if enemy is not None:
        position = state["self"]["position"]
        action["aimDirection"] = {"x": enemy["position"]["x"] - position["x"],
                                  "y": enemy["position"]["y"] - position["y"]}
        action["shoot"] = state["self"]["canShoot"]
    return action
`,
};

const omniExamples = {
  javascript: `function tick({ tick, self, enemy }) {
  if (tick < 18) return { thrust: { x: 0, y: -1 } };
  if (tick < 30) return {}; // ${text.omniBrakeComment}
  if (tick < 46) return { thrust: { x: 0, y: 1 } };
  if (!enemy) return {};
  return {
    aimDirection: { x: enemy.position.x - self.position.x, y: enemy.position.y - self.position.y },
    shoot: self.canShoot,
  };
}`,
  python: `def tick(state):
    tick = state["tick"]
    if tick < 18:
        return {"thrust": {"x": 0, "y": -1}}
    if tick < 30:
        return {}  # ${text.omniBrakeComment}
    if tick < 46:
        return {"thrust": {"x": 0, "y": 1}}

    self = state["self"]
    enemy = state["enemy"]
    if enemy is None:
        return {}
    return {
        "aimDirection": {"x": enemy["position"]["x"] - self["position"]["x"],
                         "y": enemy["position"]["y"] - self["position"]["y"]},
        "shoot": self["canShoot"],
    }
`,
};

const modelOptions = Object.entries(text.movements).map(([id, label]) =>
  <option key={id} value={id}>{label}</option>);

function App() {
  const [page, setPage] = useState<Page>(() => location.hash === '#ugc' ? 'community' : Object.hasOwn(ui.nav, location.hash.slice(1).split('/')[0]) ? location.hash.slice(1).split('/')[0] as Page : new URLSearchParams(location.search).has('share') ? 'community' : 'home');
  const [session, setSession] = useState<AuthSession>();
  const [authNotice, setAuthNotice] = useState<AuthNotice>();
  const [onlineWorkshop, setOnlineWorkshop] = useState(location.hash === '#workshop/online');
  const [training, setTraining] = useState(location.hash === '#learn/pve');
  const [rooms, setRooms] = useState(location.hash === '#arena/rooms');
  const [settings, setSettings] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [demoInvite, setDemoInvite] = useState(() => localStorage.getItem('botarena-first-run-v2') !== 'done');
  const [demoStartPulse, setDemoStartPulse] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [library, setLibrary] = useState(loadStrategies);
  const [strategyName, setStrategyName] = useState<string>(ui.defaultName);
  const [libraryNote, setLibraryNote] = useState('');
  const [libraryId, setLibraryId] = useState<string>();
  const editorPanel = useRef<HTMLFormElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<AppMode>(() => location.hash.startsWith('#arena') ? 'lab' : 'campaign');
  const [languages, setLanguages] = useState<StrategyLanguage[]>(['javascript']);
  const [language, setLanguage] = useState<StrategyLanguage>('javascript');
  const [labSetup, setLabSetup] = useState<LabSetup>(loadLabSetup);
  const [presets, setPresets] = useState<BehaviorPresetInfo[]>([]);
  const [mapError, setMapError] = useState('');
  const [selectedWalls, setSelectedWalls] = useState<number[]>([]);
  const [labSettingsOpen, setLabSettingsOpen] = useState(false);
  const [strategyHelpOpen, setStrategyHelpOpen] = useState(false);
  const [labArenaView, setLabArenaView] = useState<'edit' | 'replay'>('edit');
  const [campaignDrafts, setCampaignDrafts] = useState<
    Record<string, Record<string, Partial<Record<StrategyLanguage, string>>>>
  >({});
  const [tracks, setTracks] = useState<CampaignTrack[]>([]);
  const [trackId, setTrackId] = useState<string>();
  const [levelId, setLevelId] = useState('');
  const [playerBotId, setPlayerBotId] = useState('player');
  const [completed, setCompleted] = useState(loadCompletedLevels);
  const [campaignNote, setCampaignNote] = useState('');
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [loading, setLoading] = useState(false);
  const [jobStatus, setJobStatus] = useState<MatchJobStatus>();
  const activeRun = useRef<AbortController | null>(null);
  const [error, setError] = useState('');
  const [scriptError, setScriptError] = useState<ScriptError>();
  const [replay, setReplay] = useState<Replay>();
  const [logs, setLogs] = useState<StrategyLogLine[]>([]);

  const track = tracks.find(item => item.id === trackId);
  const levels = track?.levels ?? [];
  const level = levels.find(item => item.id === levelId);
  const playerBotIds = level?.playerBotIds ?? ['player'];
  const campaignActiveBotId = playerBotIds.includes(playerBotId) ? playerBotId : playerBotIds[0];
  const labCustomBots = customBots(labSetup);
  const labActiveBot = labCustomBots.find(bot => bot.id === labSetup.activeBotId) ?? labCustomBots[0];
  const movement: Movement = mode === 'lab' ? (labActiveBot?.movement ?? 'tracked') : 'tracked';
  const inCampaignHub = mode === 'campaign' && !track;
  const code = mode === 'lab'
    ? (labActiveBot?.code[language] ?? '')
    : campaignDrafts[levelId]?.[campaignActiveBotId]?.[language]
      ?? level?.starters?.[campaignActiveBotId]?.[language]
      ?? level?.starter[language]
      ?? '';
  const errorSnippet = scriptError
    ? formatErrorSnippet(code, scriptError.line, scriptError.column)
    : '';

  useEffect(() => {
    saveLabSetup(labSetup);
  }, [labSetup]);

  const updateCode = useCallback((value: string) => {
    setLibraryNote('');
    if (mode === 'lab') {
      if (!labActiveBot) return;
      setLabSetup(previous => ({
        ...previous,
        bots: previous.bots.map(bot => bot.id === labActiveBot.id
          ? { ...bot, code: { ...bot.code, [language]: value } }
          : bot),
      }));
      return;
    }
    setCampaignDrafts(previous => ({
      ...previous,
      [levelId]: {
        ...previous[levelId],
        [campaignActiveBotId]: { ...previous[levelId]?.[campaignActiveBotId], [language]: value },
      },
    }));
  }, [campaignActiveBotId, labActiveBot, language, levelId, mode]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const [presetResponse, campaignResponse] = await Promise.all([
          fetch('/api/behavior-presets', { signal: controller.signal }),
          fetch('/api/campaign', { signal: controller.signal }),
        ]);
        if (!presetResponse.ok) throw new Error('presets');
        if (!campaignResponse.ok) throw new Error('campaign');
        const presetList: BehaviorPresetInfo[] = await presetResponse.json();
        const campaignTracks: CampaignTrack[] = await campaignResponse.json();
        setPresets(presetList);
        setTracks(campaignTracks);
      } catch (problem) {
        if (controller.signal.aborted) return;
        setError(problem instanceof Error && problem.message === 'campaign'
          ? text.campaign.unavailable
          : text.lab.presetsUnavailable);
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

  useEffect(() => {
    const reload = () => void ugcApi.session().then(setSession).catch(() => setSession({ authenticated: false }));
    reload();
    window.addEventListener('botarena-auth-changed', reload);
    window.addEventListener('botarena-balance-changed', reload);
    return () => {
      window.removeEventListener('botarena-auth-changed', reload);
      window.removeEventListener('botarena-balance-changed', reload);
    };
  }, []);

  useEffect(() => {
    const notify = (event: Event) => setAuthNotice((event as CustomEvent<AuthNotice>).detail);
    window.addEventListener('botarena-auth-notice', notify);
    return () => window.removeEventListener('botarena-auth-notice', notify);
  }, []);

  function resetRunState() {
    activeRun.current?.abort();
    setError('');
    setScriptError(undefined);
    setReplay(undefined);
    setLabArenaView('edit');
    setLogs([]);
    setCampaignNote('');
    setJobStatus(undefined);
  }

  function selectMode(next: AppMode) {
    if (next === mode) return;
    resetRunState();
    setMode(next);
    setTrackId(undefined);
    setLevelId('');
    setEditorEpoch(value => value + 1);
  }

  function navigate(next: Page) {
    if (loading) return;
    setAuthNotice(undefined);
    setPage(next);
    const destination = new URL(location.href);
    destination.hash = next === 'community' ? '#ugc' : next === 'workshop' && onlineWorkshop ? '#workshop/online' : `#${next}`;
    if (next !== 'community') destination.searchParams.delete('share');
    history.replaceState(null, '', destination.pathname + destination.search + destination.hash);
    setExpanded(false);
    if (next === 'learn') { setTraining(false); selectMode('campaign'); }
    if (next === 'arena') { setRooms(false); selectMode('lab'); }
  }

  function startQuickDemo() {
    const setup = loadLabSetup();
    const player = setup.bots.find(bot => bot.teamId === 'player') ?? setup.bots[0];
    setLabSetup({ ...setup, activeBotId: player.id, bots: setup.bots.map(bot => bot.id === player.id
      ? { ...bot, source: 'code', code: { ...bot.code, javascript: quickDemoCode } }
      : bot) });
    setLanguage('javascript'); setMode('lab'); setPage('arena'); setRooms(false); setLabArenaView('edit');
    setEditorEpoch(value => value + 1);
    history.replaceState(null, '', '#arena');
    setAuthNotice({ message: 'Пример вставлен. Нажмите «Запустить», чтобы посмотреть первый бой.', canLogin: false });
    localStorage.setItem('botarena-first-run-v2', 'done');
    setDemoInvite(false);
    window.setTimeout(() => {
      startButton.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setDemoStartPulse(true);
    }, 350);
  }

  useEffect(() => {
    const refresh = () => setLibrary(loadStrategies());
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);

  function detachStrategy() {
    setLibraryId(undefined);
    setStrategyName(ui.defaultName);
    setLibraryNote('');
  }

  function removeStrategy(id: string) {
    const next = loadStrategies().filter(item => item.id !== id);
    if (!saveStrategies(next)) { setLibraryNote(ui.storageError); return; }
    setLibrary(next);
    if (id === libraryId) detachStrategy();
  }

  function saveCurrentStrategy() {
    const item: SavedStrategy = { id: libraryId ?? crypto.randomUUID(),
      name: strategyName.trim() || ui.defaultName, code, language, movement };
    const next = [item, ...loadStrategies().filter(entry => entry.id !== item.id)];
    if (!saveStrategies(next)) { setLibraryNote(ui.storageError); return; }
    setLibrary(next); setLibraryId(item.id); setLibraryNote(ui.saved);
  }

  function openStrategy(item: SavedStrategy) {
    if (!languages.includes(item.language)) { setLibraryNote(ui.pythonRequired); return; }
    navigate('arena');
    resetRunState();
    const setup = loadLabSetup();
    const bot = setup.bots.find(b => b.teamId === 'player')!;
    setLabSetup({ ...setup, activeBotId: bot.id, bots: setup.bots.map(b => b.id === bot.id
      ? { ...b, source: 'code', code: { ...b.code, [item.language]: item.code }, movement: item.movement } : b) });
    setLanguage(item.language);
    setStrategyName(item.name); setLibraryId(item.id); setLibraryNote('');
    setEditorEpoch(value => value + 1);
  }

  function openTrack(next: CampaignTrack) {
    if (!next.available || next.levels.length === 0) return;
    resetRunState();
    setTrackId(next.id);
    const firstOpen = next.levels.find(item => !completed.includes(item.id) && isLevelUnlocked(item.order, next.levels, completed))
      ?? next.levels[0];
    setLevelId(firstOpen?.id ?? '');
    setPlayerBotId(firstOpen?.playerBotIds?.[0] ?? 'player');
    setEditorEpoch(value => value + 1);
  }

  function backToHub() {
    resetRunState();
    setTrackId(undefined);
    setLevelId('');
  }

  function selectLevel(nextId: string) {
    const next = levels.find(item => item.id === nextId);
    if (!next || !isLevelUnlocked(next.order, levels, completed)) return;
    setLevelId(nextId);
    setPlayerBotId(next.playerBotIds?.[0] ?? 'player');
    setError('');
    setScriptError(undefined);
    setReplay(undefined);
    setLogs([]);
    setCampaignNote('');
    setEditorEpoch(value => value + 1);
  }

  function loadStarter() {
    if (!level) return;
    const ids = level.playerBotIds ?? ['player'];
    const nextBots: Record<string, Partial<Record<StrategyLanguage, string>>> = {};
    for (const botId of ids) {
      nextBots[botId] = {
        ...campaignDrafts[level.id]?.[botId],
        [language]: level.starters?.[botId]?.[language] ?? level.starter[language],
      };
    }
    setCampaignDrafts(previous => ({
      ...previous,
      [level.id]: { ...previous[level.id], ...nextBots },
    }));
    setEditorEpoch(value => value + 1);
  }

  function collectBotCodes(): Record<string, string> | undefined {
    if (!level) return undefined;
    const ids = level.playerBotIds ?? ['player'];
    if (ids.length <= 1) return undefined;
    const codes: Record<string, string> = {};
    for (const botId of ids) {
      codes[botId] = campaignDrafts[level.id]?.[botId]?.[language]
        ?? level.starters?.[botId]?.[language]
        ?? level.starter[language]
        ?? '';
    }
    return codes;
  }

  function updateRoster(allyCount: number, enemyCount: number) {
    const allies = Math.min(4, Math.max(1, allyCount || 1));
    const enemies = Math.min(4, Math.max(1, enemyCount || 1));
    const bots = layoutBots(allies, enemies, labSetup.bots);
    const blocked = bots.find(bot => labSetup.arena.walls.some(wall => wallOverlapsBot(wall, bot)));
    if (blocked) {
      setMapError(text.lab.rosterOverlapsWall(botLabel(blocked.id, blocked.teamId, bots)));
      return;
    }
    setMapError('');
    detachStrategy();
    const custom = bots.filter(bot => bot.source === 'code');
    setLabSetup({
      ...labSetup,
      allyCount: allies,
      enemyCount: enemies,
      bots,
      activeBotId: custom.some(bot => bot.id === labSetup.activeBotId)
        ? labSetup.activeBotId
        : (custom[0]?.id ?? bots[0].id),
    });
    setEditorEpoch(value => value + 1);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (activeRun.current) return;
    setDemoStartPulse(false);
    if (mode === 'campaign' && level && !isLevelUnlocked(level.order, levels, completed)) return;
    setExpanded(false);
    const controller = new AbortController();
    activeRun.current = controller;
    setLoading(true);
    setJobStatus(undefined);
    setError('');
    setScriptError(undefined);
    setReplay(undefined);
    setLogs([]);
    setCampaignNote('');
    try {
      let match;
      if (mode === 'lab') {
        const payload = buildCustomMatchPayload(labSetup, language);
        match = await runMatch(
          payload.botCode,
          language,
          controller.signal,
          setJobStatus,
          { customMatch: payload.customMatch },
        );
      } else {
        const botCodes = collectBotCodes();
        const primaryCode = botCodes
          ? (botCodes[campaignActiveBotId] || Object.values(botCodes)[0] || code)
          : code;
        match = await runMatch(
          primaryCode,
          language,
          controller.signal,
          setJobStatus,
          { campaignLevelId: levelId },
          botCodes,
        );
      }
      setReplay(match.replay);
      if (mode === 'lab') setLabArenaView('replay');
      setLogs(match.logs ?? []);
      setScriptError(match.error ?? undefined);
      if (mode === 'campaign' && level && !match.error && teamWon(match.replay.result)) {
        const nextCompleted = session?.authenticated
          ? markLevelCompleted(level.id)
          : completed.includes(level.id) ? completed : [...completed, level.id];
        setCompleted(nextCompleted);
        const nextLevel = levels.find(item => item.order === level.order + 1);
        setCampaignNote(session?.authenticated
          ? nextLevel ? text.campaign.success : text.campaign.finished
          : 'Уровень пройден в гостевом режиме. Войдите или зарегистрируйтесь, чтобы сохранить прогресс.');
      }
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

  function trackProgress(item: CampaignTrack) {
    if (item.levelCount === 0) return text.campaign.comingSoon;
    const done = item.levels.filter(levelItem => completed.includes(levelItem.id)).length;
    return text.campaign.progress(done, item.levelCount);
  }

  const campaignCodes = mode === 'campaign' ? collectBotCodes() : undefined;
  const campaignCodesReady = campaignCodes
    ? Object.values(campaignCodes).every(item => item.trim().length > 0 && item.length <= 16384)
    : code.trim().length > 0 && code.length <= 16384;
  const labCodesReady = labSetup.bots
    .filter(bot => bot.source === 'code')
    .every(bot => {
      const value = bot.code[language] ?? '';
      return value.trim().length > 0 && value.length <= 16384;
    });
  const canRun = mode === 'lab'
    ? labSetup.bots.length >= 2 && labCodesReady
    : Boolean(level && isLevelUnlocked(level.order, levels, completed) && campaignCodesReady);

  return (
    <main className={`platform-app${expanded ? ' editor-expanded' : ''}`}>
      <header className="platform-header">
        <button className="platform-brand" onClick={() => navigate('home')}>◈ <span>{text.brand}<small>CODE · SIMULATE · EVOLVE</small></span></button>
        <nav aria-label="Основная навигация">{Object.entries(ui.nav).map(([id, label]) =>
          <button key={id} type="button" aria-current={page === id ? 'page' : undefined}
            disabled={loading} onClick={() => navigate(id as Page)}>{label}</button>)}</nav>
        <div className="platform-account"><button className="tour-launch" onClick={() => setTourOpen(true)}>？ Обзор</button><AuthPanel session={session} onChange={setSession} /><button className="platform-settings-button" title={ui.settings} aria-label={ui.settings} onClick={() => setSettings(true)}>⚙</button></div>
      </header>
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {tourOpen && <SystemTour onClose={() => setTourOpen(false)} onNavigate={navigate} />}
      {labSettingsOpen && <ArenaModal title={ui.roster} wide onClose={() => setLabSettingsOpen(false)}>
        <LabSettingsDialog
          setup={labSetup}
          presets={presets}
          onRosterChange={updateRoster}
          onReset={() => {
            detachStrategy();
            setMapError('');
            setLabSetup(defaultLabSetup());
            setSelectedWalls([]);
            setEditorEpoch(value => value + 1);
          }}
          onBotChange={(id, patch) => setLabSetup(previous => ({
            ...previous,
            bots: previous.bots.map(bot => bot.id === id ? { ...bot, ...patch } : bot),
          }))}
          onBehaviorChange={(id, value) => {
            detachStrategy();
            setLabSetup(previous => {
              const bots = previous.bots.map(bot => bot.id !== id ? bot : value === 'code'
                ? { ...bot, source: 'code' as const }
                : { ...bot, source: 'preset' as const, presetId: value, movement: 'tracked' as const });
              const custom = bots.filter(bot => bot.source === 'code');
              return { ...previous, bots, activeBotId: custom.some(bot => bot.id === previous.activeBotId)
                ? previous.activeBotId : (custom[0]?.id ?? previous.activeBotId) };
            });
            setEditorEpoch(value => value + 1);
          }}
        />
      </ArenaModal>}
      {strategyHelpOpen && <ArenaModal title={text.help.title} wide onClose={() => setStrategyHelpOpen(false)}>
        <StrategyHelpContent language={language} movement={movement} />
      </ArenaModal>}
      <div className="platform-content">
      {session && !session.authenticated && <div className="guest-banner"><b>Гостевой режим</b><span>Можно запускать одиночные бои, но прогресс не сохраняется.</span><button onClick={() => window.dispatchEvent(new CustomEvent('botarena-open-auth'))}>Войти или зарегистрироваться</button></div>}
      {authNotice && <div className="auth-callout auth-feedback" role="status"><p>{authNotice.message}</p><div className="ux-actions">{authNotice.canLogin && <button className="account-login" onClick={() => window.dispatchEvent(new CustomEvent('botarena-open-auth'))}>Войти / Регистрация</button>}<button type="button" onClick={() => setAuthNotice(undefined)}>{ui.close}</button></div></div>}
      <Suspense fallback={<div className="empty">{ui.loadingSection}</div>}>
      {page === 'home' ? <><Home tracks={tracks} completed={completed} languages={languages} navigate={navigate} onDemo={startQuickDemo} demoInvite={demoInvite} onContinue={() => {
          navigate('learn');
          const next = tracks.find(t => t.available && t.levels.some(l => !completed.includes(l.id) && isLevelUnlocked(l.order, t.levels, completed)));
          if (next) openTrack(next);
        }} />{error && <p role="alert" className="error-card">{error}</p>}</>
      : page === 'workshop' ? <><div className="ux-tabs"><button aria-pressed={!onlineWorkshop} onClick={() => { setOnlineWorkshop(false); history.replaceState(null, '', '#workshop'); }}>{ui.localStrategies}</button><button aria-pressed={onlineWorkshop} onClick={() => { setOnlineWorkshop(true); history.replaceState(null, '', '#workshop/online'); }}>{ui.onlineWorkshop}</button></div>{onlineWorkshop ? <UgcHub /> : <Workshop items={library} onOpen={openStrategy}
          onRemove={removeStrategy}
          onArena={() => { setLibraryId(undefined); setStrategyName(ui.defaultName); navigate('arena'); }} />}</>
      : page === 'community' ? <UgcHub />
      : <>
        <div className="ux-page-heading"><div><h1>{ui.nav[page]}</h1><p>{page === 'learn' ? ui.learnIntro : ui.arenaIntro}</p></div></div>
        {page === 'learn' && <div className="ux-tabs"><button aria-pressed={!training} onClick={() => { setTraining(false); history.replaceState(null, '', '#learn'); }}>{ui.learningLab}</button><button aria-pressed={training} onClick={() => { setTraining(true); history.replaceState(null, '', '#learn/pve'); }}>{ui.pveProgress}</button></div>}
        {page === 'learn' && training ? <PveMap session={session} /> : <>
        {page === 'arena' && <div className="ux-tabs"><button aria-pressed={!rooms} onClick={() => { setRooms(false); history.replaceState(null, '', '#arena'); }}>{ui.pve}</button><button aria-pressed={rooms} onClick={() => { setRooms(true); history.replaceState(null, '', '#arena/rooms'); }}>{ui.rooms}</button></div>}
        {page === 'arena' && rooms ? session?.authenticated ? <RoomsPanel /> : <section className="panel auth-required"><h2>{ui.roomsTitle}</h2><p>{ui.roomsAuth}</p><button className="account-login" onClick={() => window.dispatchEvent(new CustomEvent('botarena-open-auth'))}>Войти / Регистрация</button></section> : <>
      {inCampaignHub ? (
        <>
          {error && <p role="alert" className="error-card">{error}</p>}
          <LearningMap tracks={tracks} completed={completed} onOpen={(item, nextId) => {
            openTrack(item);
            setLevelId(nextId);
            setPlayerBotId(item.levels.find(l => l.id === nextId)?.playerBotIds?.[0] ?? 'player');
          }} />
        </>
      ) : (
        <>
        <div className="arena-workspace-toolbar">
          {mode === 'lab' && <button type="button" onClick={() => setLabSettingsOpen(true)}>⚙ {ui.roster}</button>}
          <button type="button" onClick={() => setStrategyHelpOpen(true)}>？ {text.help.title}</button>
        </div>
        <div className="layout">
          <form ref={editorPanel} className="panel editor" onSubmit={run}>
            <div className="ux-editor-heading"><small>{ui.editor}</small><button type="button" onClick={() => setExpanded(!expanded)}>{expanded ? ui.collapse : ui.focus}</button></div>
            {mode === 'campaign' && (
              <button type="button" className="campaign-back" onClick={backToHub}>
                {text.campaign.backToHub}
              </button>
            )}
            <h1>{mode === 'campaign' ? (level?.name ?? track?.name ?? text.campaign.levelsTitle) : text.strategy}</h1>
            {mode === 'campaign' && (
              <details className="campaign-levels"><summary>{ui.levels}</summary>
                {levels.length === 0 && <p className="muted">{text.campaign.emptyTrack}</p>}
                {levels.map(item => {
                  const unlocked = isLevelUnlocked(item.order, levels, completed);
                  const done = completed.includes(item.id);
                  return (
                    <button key={item.id} type="button"
                      className={[
                        'level-card',
                        item.id === levelId ? 'selected' : '',
                        done ? 'done' : '',
                        unlocked ? '' : 'locked',
                      ].filter(Boolean).join(' ')}
                      disabled={!unlocked}
                      aria-pressed={item.id === levelId}
                      onClick={() => selectLevel(item.id)}>
                      <span className="level-order">{item.order}</span>
                      <span className="level-body">
                        <strong>{item.name}</strong>
                        <span className="muted">
                          {done ? text.campaign.completed : unlocked ? text.campaign.open : text.campaign.locked}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </details>
            )}
            {mode === 'campaign' && level && (
              <div className="campaign-brief">
                <p>{level.summary}</p>
                <p className="muted">
                  <strong>{text.campaign.objective}: </strong>
                  {text.campaign.objectives[level.objective as keyof typeof text.campaign.objectives] ?? level.objective}
                </p>
                <p className="muted"><strong>{text.campaign.hint}: </strong>{level.hint}</p>
                <button type="button" onClick={loadStarter}>{text.campaign.loadStarter}</button>
              </div>
            )}

            {mode === 'lab' && labArenaView === 'replay' && mapError && <p role="alert" className="error-card">{mapError}</p>}
            <div className="strategy-language">
              <label className="muted" htmlFor="strategy-language">{text.chooseLanguage}</label>
              <select id="strategy-language" aria-label={text.languageLabel} value={language} disabled={loading}
                onChange={event => {
                  detachStrategy();
                  setLanguage(event.target.value as StrategyLanguage);
                  setEditorEpoch(value => value + 1);
                }}>
                {languages.map(item => <option key={item} value={item}>{text.languages[item]}</option>)}
              </select>
            </div>
            {mode === 'lab' && <div className="strategy-language">
              <label htmlFor="movement">{text.movementLabel}</label>
              <select id="movement" value={movement}
                disabled={loading || !labActiveBot}
                onChange={event => setLabSetup(previous => ({ ...previous, bots: previous.bots.map(bot => bot.id === labActiveBot?.id ? { ...bot, movement: event.target.value as Movement } : bot) }))}>
                {modelOptions}
              </select>
            </div>}
            {mode === 'lab' && labActiveBot && <button type="button" onClick={() => {
              updateCode(({ tracked: trackedExamples, hover: hoverExamples, wheeled: wheeledExamples, omni: omniExamples })[movement][language]);
              setEditorEpoch(value => value + 1);
            }}>{ui.chassisExample}</button>}
            <details className="movement-help">
              <summary>{text.movementHelpTitle}</summary>
              <p>{text.movementDescriptions[movement]}</p>
            </details>
            {mode === 'campaign' && level && playerBotIds.length > 1 && (
              <div className="tank-tabs" role="tablist" aria-label={text.campaign.tankTabs}>
                {playerBotIds.map(botId => (
                  <button
                    key={botId}
                    type="button"
                    role="tab"
                    className={botId === campaignActiveBotId ? 'tank-tab active' : 'tank-tab'}
                    aria-selected={botId === campaignActiveBotId}
                    onClick={() => {
                      setPlayerBotId(botId);
                      setEditorEpoch(value => value + 1);
                    }}
                  >
                    {botLabel(botId, 'player', level.spawns)}
                  </button>
                ))}
              </div>
            )}
            {mode === 'lab' && labCustomBots.length > 0 && (
              <div className="tank-tabs" role="tablist" aria-label={text.lab.bots}>
                {labCustomBots.map(bot => (
                  <button
                    key={bot.id}
                    type="button"
                    role="tab"
                    className={bot.id === labActiveBot?.id ? 'tank-tab active' : 'tank-tab'}
                    aria-selected={bot.id === labActiveBot?.id}
                    onClick={() => {
                      detachStrategy();
                      setLabSetup(previous => ({ ...previous, activeBotId: bot.id }));
                      setEditorEpoch(value => value + 1);
                    }}
                  >
                    {botLabel(bot.id, bot.teamId, labSetup.bots)}
                  </button>
                ))}
              </div>
            )}
            {(mode === 'campaign' || labCustomBots.length > 0) && (
              <Suspense fallback={<div className="code-editor" />}>
                <StrategyEditor
                  key={`${mode}-${trackId}-${levelId}-${labActiveBot?.id ?? campaignActiveBotId}-${language}-${editorEpoch}`}
                  language={language}
                  initialCode={code}
                  onChange={updateCode}
                />
              </Suspense>
            )}
            {mode === 'lab' && labCustomBots.length === 0 && (
              <p className="muted">{text.lab.sourcePreset}: {text.lab.customCode.toLowerCase()} не выбран — все на пресетах.</p>
            )}
            {!session?.authenticated && <div className="auth-callout"><div className="auth-callout-copy"><strong>Гостевой бой доступен</strong><p>Результат можно посмотреть, но прогресс сохранится только после входа или регистрации.</p></div></div>}
            <button ref={startButton} data-tour-target="arena-run" className={`primary ${demoStartPulse ? 'demo-start-pulse' : ''}`} disabled={loading || !canRun}>
              {loading ? text.working : text.start}
            </button>
            {code.length > 16384 && <p role="alert" className="error">{text.strategyTooLong}</p>}
            {jobStatus?.state === 'queued' && <p role="status">{text.queuePosition(jobStatus.position)}</p>}
            {mode === 'lab' && labCustomBots.length > 0 && <div className="ux-save"><input aria-label={ui.name} value={strategyName} maxLength={100} onChange={e => setStrategyName(e.target.value)} /><button type="button" onClick={saveCurrentStrategy}>{ui.save}</button>{libraryNote && <small role="status">{libraryNote}</small>}</div>}
            {error && <p role="alert" className="error-card">{error}</p>}
            {campaignNote && <p role="status" className="success-card">{campaignNote}</p>}
            {scriptError && (
              <div role="alert" className="error-card">
                <div className="error-heading">
                  <strong>{text.diagnostic.title}</strong>
                  <span>{botLabel(
                    scriptError.botId,
                    undefined,
                    mode === 'lab' ? labSetup.bots : (level?.spawns ?? [{ id: scriptError.botId }]),
                  )}</span>
                </div>
                <p className="error-phase">
                  {scriptError.tick == null ? text.diagnostic.load : text.diagnostic.tickFailure}
                </p>
                <p className="error-message">{scriptError.message}</p>
                <dl className="error-details">
                  {scriptError.line != null && <div><dt>{text.diagnostic.line}</dt><dd>{scriptError.line}</dd></div>}
                  {scriptError.column != null && <div><dt>{text.diagnostic.column}</dt><dd>{scriptError.column}</dd></div>}
                  {scriptError.tick != null && <div><dt>{text.diagnostic.tick}</dt><dd>{scriptError.tick}</dd></div>}
                </dl>
                {errorSnippet && (
                  <div className="error-snippet">
                    <strong>{text.diagnostic.snippet}</strong>
                    <pre>{errorSnippet}</pre>
                  </div>
                )}
              </div>
            )}
            <details className="debug-panel" open={logs.length > 0}>
              <summary>{text.debug.title}</summary>
              {logs.length === 0 ? (
                <p className="debug-empty">{text.debug.empty}</p>
              ) : (
                <ul className="debug-log">
                  {logs.map((entry, index) => (
                    <li key={`${entry.tick}-${index}`}>
                      <time>{entry.tick == null ? text.debug.load : text.debug.tick(entry.tick)}</time>
                      <span>{entry.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>

          </form>
          <section className="panel replay">
            <div className="arena-panel-heading">
              <div className="arena-title"><h2>{text.arena}</h2>{mode === 'lab' && <span className="arena-info" tabIndex={0} role="img" aria-label={text.lab.mapHint} data-tooltip={text.lab.mapHint}>i</span>}</div>
              {replay && <button type="button" onClick={() => { setExpanded(false); editorPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{ui.backCode}</button>}
              {mode === 'lab' && (
                <div className="lab-arena-tabs" role="tablist" aria-label={text.arena}>
                  <button
                    type="button"
                    role="tab"
                    className={labArenaView === 'edit' ? 'tank-tab active' : 'tank-tab'}
                    aria-selected={labArenaView === 'edit'}
                    onClick={() => setLabArenaView('edit')}
                  >
                    {text.lab.editMap}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    className={labArenaView === 'replay' ? 'tank-tab active' : 'tank-tab'}
                    aria-selected={labArenaView === 'replay'}
                    disabled={!replay}
                    onClick={() => setLabArenaView('replay')}
                  >
                    {text.lab.watchReplay}
                  </button>
                </div>
              )}
            </div>
            {mode === 'lab' && labArenaView === 'edit' ? (
              <LabArenaEditor
                arena={labSetup.arena}
                bots={labSetup.bots}
                selectedWalls={selectedWalls}
                placementError={mapError}
                onPlacementError={setMapError}
                onSelectWalls={setSelectedWalls}
                onMoveBot={(botId, x, y) => setLabSetup(previous => ({
                  ...previous,
                  bots: previous.bots.map(bot => bot.id === botId
                    ? { ...bot, position: { x, y } }
                    : bot),
                }))}
                onChangeWall={(index, wall) => setLabSetup(previous => ({
                  ...previous,
                  arena: {
                    ...previous.arena,
                    walls: previous.arena.walls.map((item, wallIndex) =>
                      wallIndex === index ? wall : item),
                  },
                }))}
                onAddWall={wall => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: {
                      ...previous.arena,
                      walls: [...previous.arena.walls, wall],
                    },
                  }));
                  setSelectedWalls([labSetup.arena.walls.length]);
                }}
                onRemoveWalls={indices => {
                  const removed = new Set(indices);
                  setLabSetup(previous => ({
                    ...previous,
                    arena: {
                      ...previous.arena,
                      walls: previous.arena.walls.filter((_, wallIndex) => !removed.has(wallIndex)),
                    },
                  }));
                  setSelectedWalls([]);
                }}
                onClassicWalls={() => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: { ...previous.arena, walls: classicWalls.map(wall => ({ ...wall })) },
                  }));
                  setSelectedWalls([]);
                }}
              />
            ) : replay ? (
              <Suspense fallback={<div className="empty">Загружаем WebGL‑сцену…</div>}>
                <ReplayPlayer
                  replay={replay}
                  botNames={mode === 'lab'
                    ? Object.fromEntries(labSetup.bots.map(bot => [bot.id, bot.name]))
                    : undefined}
                />
              </Suspense>
            ) : mode === 'campaign' && level ? (
              <ArenaPreview arena={level.arena} spawns={level.spawns} marker={level.marker} />
            ) : (
              <div className="empty">{text.emptyArena}</div>
            )}
          </section>
        </div>
        </>
      )}
        </>}
        </>}
      </>}
      {page === 'workshop' && libraryNote && <p role="status" className="ux-notice">{libraryNote}</p>}
      </Suspense>
      <footer className="platform-footer"><strong>BotArena</strong><span>{ui.footer}</span></footer>
      </div>
    </main>
  );
}

document.title = text.title;
document.documentElement.lang = text.language;
createRoot(document.getElementById('root')!).render(<App />);
