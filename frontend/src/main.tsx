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
import { LabArenaEditor } from './LabArenaEditor';
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
import { StrategyHelp } from './StrategyHelp';
import { AuthPanel } from './AuthPanel';
import { PveMap } from './PveMap';
import { UgcHub } from './UgcHub';
import { login, ugcApi } from './ugcApi';
import { text } from './text';
import './style.css';

const StrategyEditor = lazy(() => import('./StrategyEditor'));
const ReplayPlayer = lazy(() => import('./ReplayPlayer').then(module => ({ default: module.ReplayPlayer })));

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

function ArenaApp() {
  const [mode, setMode] = useState<AppMode>('campaign');
  const [languages, setLanguages] = useState<StrategyLanguage[]>(['javascript']);
  const [language, setLanguage] = useState<StrategyLanguage>('javascript');
  const [movement, setMovement] = useState<Movement>('tracked');
  const [labSetup, setLabSetup] = useState<LabSetup>(loadLabSetup);
  const [presets, setPresets] = useState<BehaviorPresetInfo[]>([]);
  const [selectedWall, setSelectedWall] = useState<number | null>(null);
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

  function openTrack(next: CampaignTrack) {
    if (!next.available || next.levels.length === 0) return;
    resetRunState();
    setTrackId(next.id);
    const firstOpen = next.levels.find(item => isLevelUnlocked(item.order, next.levels, completed))
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
    setLabSetup(previous => {
      const bots = layoutBots(allies, enemies, previous.bots);
      const custom = bots.filter(bot => bot.source === 'code');
      return {
        ...previous,
        allyCount: allies,
        enemyCount: enemies,
        bots,
        activeBotId: custom.some(bot => bot.id === previous.activeBotId)
          ? previous.activeBotId
          : (custom[0]?.id ?? bots[0].id),
      };
    });
    setEditorEpoch(value => value + 1);
  }

  async function run(event: FormEvent) {
    event.preventDefault();
    if (activeRun.current) return;
    if (mode === 'campaign' && level && !isLevelUnlocked(level.order, levels, completed)) return;
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
        const nextCompleted = markLevelCompleted(level.id);
        setCompleted(nextCompleted);
        const nextLevel = levels.find(item => item.order === level.order + 1);
        setCampaignNote(nextLevel ? text.campaign.success : text.campaign.finished);
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
    <main>
      <header>
        <span>{text.brand}</span>
        <nav className="mode-switch" aria-label="Режим">
          {(['campaign', 'lab'] as const).map(item => (
            <button key={item} type="button" className={mode === item ? 'mode active' : 'mode'}
              aria-pressed={mode === item} onClick={() => selectMode(item)}>
              {text.modes[item]}
            </button>
          ))}
        </nav>
        <span className="muted">{text.modeHint[mode]}</span>
      </header>

      {inCampaignHub ? (
        <section className="panel campaign-hub">
          <h1>{text.campaign.hubTitle}</h1>
          <p className="campaign-hub-intro">{text.campaign.hubIntro}</p>
          {error && <p role="alert" className="error-card">{error}</p>}
          <div className="campaign-tracks">
            {tracks.map(item => (
              <button key={item.id} type="button" className="campaign-track"
                disabled={!item.available || item.levels.length === 0}
                onClick={() => openTrack(item)}>
                <div className="campaign-track-top">
                  <strong>{item.name}</strong>
                  <span className="muted">{trackProgress(item)}</span>
                </div>
                <p>{item.summary}</p>
                <span className="muted">{text.campaign.levelCount(item.levelCount)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : (
        <div className="layout">
          <form className="panel editor" onSubmit={run}>
            {mode === 'campaign' && (
              <button type="button" className="campaign-back" onClick={backToHub}>
                {text.campaign.backToHub}
              </button>
            )}
            <h1>{mode === 'campaign' ? (level?.name ?? track?.name ?? text.campaign.levelsTitle) : text.strategy}</h1>
            {mode === 'campaign' && (
              <section className="campaign-levels" aria-label={text.campaign.levelsTitle}>
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
              </section>
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

            {mode === 'lab' && (
              <section className="lab-roster" aria-label={text.lab.roster}>
                <div className="lab-counts">
                  <label>
                    {text.lab.allies}
                    <input type="number" min={1} max={4} value={labSetup.allyCount}
                      onChange={event => updateRoster(Number(event.target.value), labSetup.enemyCount)} />
                  </label>
                  <label>
                    {text.lab.enemies}
                    <input type="number" min={1} max={4} value={labSetup.enemyCount}
                      onChange={event => updateRoster(labSetup.allyCount, Number(event.target.value))} />
                  </label>
                  <button type="button" onClick={() => {
                    setLabSetup(defaultLabSetup());
                    setSelectedWall(null);
                    setEditorEpoch(value => value + 1);
                  }}>{text.lab.reset}</button>
                </div>
                <ul className="lab-bot-list">
                  {labSetup.bots.map(bot => (
                    <li key={bot.id} className="lab-bot-card">
                      <label>
                        {text.lab.name}
                        <input
                          type="text"
                          maxLength={24}
                          value={bot.name}
                          placeholder={botLabel(bot.id, bot.teamId, labSetup.bots.map(item => ({ ...item, name: '' })))}
                          onChange={event => setLabSetup(previous => ({
                            ...previous,
                            bots: previous.bots.map(item => item.id === bot.id
                              ? { ...item, name: event.target.value }
                              : item),
                          }))}
                        />
                      </label>
                      <label>
                        {text.lab.hp}
                        <input type="number" min={1} max={500} value={bot.hp}
                          onChange={event => setLabSetup(previous => ({
                            ...previous,
                            bots: previous.bots.map(item => item.id === bot.id
                              ? { ...item, hp: Number(event.target.value) }
                              : item),
                          }))} />
                      </label>
                      <label>
                        {text.lab.behavior}
                        <select
                          value={bot.source === 'code' ? 'code' : bot.presetId}
                          onChange={event => {
                            const value = event.target.value;
                            setLabSetup(previous => {
                              const bots = previous.bots.map(item => {
                                if (item.id !== bot.id) return item;
                                if (value === 'code') return { ...item, source: 'code' as const };
                                return { ...item, source: 'preset' as const, presetId: value };
                              });
                              const custom = bots.filter(item => item.source === 'code');
                              return {
                                ...previous,
                                bots,
                                activeBotId: custom.some(item => item.id === previous.activeBotId)
                                  ? previous.activeBotId
                                  : (custom[0]?.id ?? previous.activeBotId),
                              };
                            });
                            setEditorEpoch(value => value + 1);
                          }}
                        >
                          <option value="code">{text.lab.customCode}</option>
                          {presets.map(preset => (
                            <option key={preset.id} value={preset.id}>
                              {preset.name} ({preset.strength === 'weak' ? text.lab.weak : text.lab.standard})
                            </option>
                          ))}
                        </select>
                      </label>
                      {bot.source === 'preset' && (
                        <p className="muted">
                          {presets.find(item => item.id === bot.presetId)?.description}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="strategy-language">
              <span className="muted" id="strategy-label">{text.strategyLanguage(language)}</span>
              <select aria-label={text.languageLabel} value={language} disabled={loading}
                onChange={event => {
                  setLanguage(event.target.value as StrategyLanguage);
                  setEditorEpoch(value => value + 1);
                }}>
                {languages.map(item => <option key={item} value={item}>{text.languages[item]}</option>)}
              </select>
            </div>
            <div className="strategy-language">
              <label htmlFor="movement">{text.movementLabel}</label>
              <select id="movement" value={movement} disabled={loading}
                onChange={event => setMovement(event.target.value as Movement)}>
                {modelOptions}
              </select>
            </div>
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
            <StrategyHelp language={language} movement={movement} />
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
            <button className="primary" disabled={loading || !canRun}>
              {loading ? text.working : text.start}
            </button>
            {code.length > 16384 && <p role="alert" className="error">{text.strategyTooLong}</p>}
            {jobStatus?.state === 'queued' && <p role="status">{text.queuePosition(jobStatus.position)}</p>}
          </form>
          <section className="panel replay">
            <div className="arena-panel-heading">
              <h2>{text.arena}</h2>
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
                selectedWall={selectedWall}
                onSelectWall={setSelectedWall}
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
                onAddWall={() => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: {
                      ...previous.arena,
                      walls: [...previous.arena.walls, { x: 6, y: 4, width: 1.5, height: 1.5 }],
                    },
                  }));
                  setSelectedWall(labSetup.arena.walls.length);
                }}
                onRemoveWall={index => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: {
                      ...previous.arena,
                      walls: previous.arena.walls.filter((_, wallIndex) => wallIndex !== index),
                    },
                  }));
                  setSelectedWall(null);
                }}
                onClassicWalls={() => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: { ...previous.arena, walls: classicWalls.map(wall => ({ ...wall })) },
                  }));
                  setSelectedWall(null);
                }}
                onClearWalls={() => {
                  setLabSetup(previous => ({
                    ...previous,
                    arena: { ...previous.arena, walls: [] },
                  }));
                  setSelectedWall(null);
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
      )}
    </main>
  );
}

type Workspace = 'learn' | 'arena' | 'community';

function App() {
  const [workspace, setWorkspace] = useState<Workspace>(() =>
    location.hash === '#ugc' ? 'community' : location.hash === '#arena' ? 'arena' : 'learn');
  const [session, setSession] = useState<AuthSession>();

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

  function open(next: Workspace, hash: string) {
    setWorkspace(next);
    history.replaceState(null, '', hash);
  }

  return <main className="app-shell">
    <header className="app-header">
      <button className="brand-button" onClick={() => open('learn', '#learn')}><span className="brand-mark">B</span><span><b>{text.brand}</b><small>CODE · FIGHT · EVOLVE</small></span></button>
      <nav aria-label="Разделы">
        <button className={workspace === 'learn' ? 'active' : ''} onClick={() => open('learn', '#learn')}><span>◫</span> Обучение</button>
        <button className={workspace === 'arena' ? 'active' : ''} onClick={() => open('arena', '#arena')}><span>⌁</span> Арена</button>
        <button className={workspace === 'community' ? 'active' : ''} onClick={() => open('community', '#ugc')}><span>♧</span> Сообщество</button>
      </nav>
      <AuthPanel session={session} onChange={setSession} />
    </header>
    {workspace === 'learn' ? <PveMap session={session} />
      : workspace === 'community' ? <UgcHub />
        : session?.authenticated ? <ArenaApp />
          : <section className="panel auth-required arena-auth"><b>Для запуска матчей нужна авторизация</b><p>Войдите через Yandex ID, чтобы использовать новый Match Lab и кампании.</p><button className="yandex-login" onClick={login}><b>Я</b> Войти через Яндекс</button></section>}
  </main>;
}

document.title = text.title;
document.documentElement.lang = text.language;
createRoot(document.getElementById('root')!).render(<App />);
