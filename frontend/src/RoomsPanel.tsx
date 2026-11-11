import { useEffect, useRef, useState } from 'react';
import type { BattleMap, GameRoom, MatchResponse, StrategyLanguage, UgcStrategyCard } from './contracts';
import { ReplayPlayer } from './ReplayPlayer';
import { isUnauthorized, login, type CreateRoom, ugcApi } from './ugcApi';

const initialRoom: CreateRoom = {
  name: '', allowClipboard: true, allowPresetStrategies: true,
  maxCharactersPerSecond: 20, stake: 0, mapId: null,
};

export function RoomsPanel() {
  const [rooms, setRooms] = useState<GameRoom[]>([]);
  const [maps, setMaps] = useState<BattleMap[]>([]);
  const [filters, setFilters] = useState({ clipboard: '', presets: '', maxCharactersPerSecond: '', maxStake: '' });
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CreateRoom>(initialRoom);
  const [room, setRoom] = useState<GameRoom>();
  const [strategies, setStrategies] = useState<UgcStrategyCard[]>([]);
  const [strategyId, setStrategyId] = useState('');
  const [language, setLanguage] = useState<StrategyLanguage>('javascript');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [match, setMatch] = useState<MatchResponse>();
  const [currentUserId, setCurrentUserId] = useState('');
  const inputTimes = useRef<number[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => { void refresh(); void ugcApi.maps().then(setMaps).catch(handleError); }, [filters.clipboard, filters.presets, filters.maxCharactersPerSecond, filters.maxStake]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);
  useEffect(() => {
    if (!waiting || !room) return;
    const timer = setInterval(() => {
      void ugcApi.room(room.id).then(result => {
        setRoom(result.room);
        if (result.match) { setMatch(result.match); setWaiting(false); window.dispatchEvent(new Event('botarena-balance-changed')); }
      }).catch(handleError);
    }, 1500);
    return () => clearInterval(timer);
  }, [waiting, room?.id]);

  function handleError(problem: unknown) {
    if (isUnauthorized(problem)) login();
    else setError(problem instanceof Error ? problem.message : 'Не удалось выполнить действие.');
  }
  async function refresh() {
    try { setRooms(await ugcApi.rooms(filters)); setError(''); }
    catch (problem) { handleError(problem); }
  }
  async function enter(next: GameRoom) {
    setBusy(true); setError(''); setNotice(''); setMatch(undefined); setWaiting(false);
    try {
      const session = await ugcApi.session();
      if (session.authenticated) setCurrentUserId(session.user.id);
      const joined = session.authenticated && session.user.id === next.creator.id ? next : await ugcApi.joinRoom(next.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      setStrategies(mine); setStrategyId(''); setCode(''); setRoom(joined);
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function create() {
    if (!form.name.trim() || form.maxCharactersPerSecond < 1 || form.maxCharactersPerSecond > 1000 || form.stake < 0 || form.stake > 100000) return;
    setBusy(true); setError('');
    try {
      const created = await ugcApi.createRoom(form);
      const session = await ugcApi.session(); if (session.authenticated) setCurrentUserId(session.user.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      setStrategies(mine); setRoom(created); setCreating(false); setForm(initialRoom); setCode(''); setStrategyId('');
      await refresh();
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  function changedCharacters(previous: string, current: string) {
    let prefix = 0;
    while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
    let suffix = 0;
    while (suffix < previous.length - prefix && suffix < current.length - prefix && previous[previous.length - suffix - 1] === current[current.length - suffix - 1]) suffix++;
    const removed = Math.max(0, previous.length - prefix - suffix);
    const inserted = Math.max(0, current.length - prefix - suffix);
    return Math.max(removed, inserted);
  }
  function changeCode(next: string) {
    if (!room || next.length > 16384) { setError('Код не может быть длиннее 16 384 символов.'); return; }
    const now = Date.now();
    inputTimes.current = inputTimes.current.filter(time => now - time < 1000);
    const cost = changedCharacters(code, next);
    if (!room.allowClipboard && cost > 1) {
      setError('В этой комнате массовая вставка и вырезание запрещены.'); return;
    }
    if (inputTimes.current.length + cost > room.maxCharactersPerSecond) {
      setError(`Лимит комнаты: ${room.maxCharactersPerSecond} символов в секунду.`); return;
    }
    inputTimes.current.push(...Array.from({ length: cost }, () => now));
    setCode(next); setStrategyId(''); setError('');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void ugcApi.updateRoomDraft(room.id, { code: next, language }).catch(handleError);
    }, 120);
  }
  async function chooseStrategy(id: string) {
    if (!room) return;
    setStrategyId(id); setError('');
    if (!id) return;
    const selected = strategies.find(item => item.id === id);
    if (selected) setLanguage(selected.language);
    try { await ugcApi.updateRoomDraft(room.id, { code: '', language: selected?.language ?? language, strategyId: id }); setNotice('Сохранённая стратегия выбрана.'); }
    catch (problem) { handleError(problem); }
  }
  async function ready() {
    if (!room) return;
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = undefined; }
    setBusy(true); setError(''); setNotice('');
    try {
      if (!strategyId) await ugcApi.updateRoomDraft(room.id, { code, language });
      const result = await ugcApi.readyRoom(room.id);
      if (result.match) { setMatch(result.match); window.dispatchEvent(new Event('botarena-balance-changed')); }
      else { setWaiting(true); setNotice('Стратегия принята. Ждём второго игрока…'); }
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!room) return;
    try { await ugcApi.cancelRoom(room.id); setRoom(undefined); await refresh(); }
    catch (problem) { handleError(problem); }
  }

  return <div className="rooms-panel">
    <div className="ugc-section-head"><div><h2>Игровые комнаты</h2><p>Выбери правила, ставку и соперника — ограничения проверяет сервер.</p></div><button className="primary" onClick={() => setCreating(true)}>+ Создать комнату</button></div>
    {error && <p className="error-card">{error}</p>}{notice && <p className="ugc-notice">{notice}</p>}
    <div className="room-filters">
      <select value={filters.clipboard} onChange={event => setFilters({ ...filters, clipboard: event.target.value })}><option value="">Ctrl+C: любой</option><option value="true">Ctrl+C разрешён</option><option value="false">Ctrl+C запрещён</option></select>
      <select value={filters.presets} onChange={event => setFilters({ ...filters, presets: event.target.value })}><option value="">Стратегии: любые</option><option value="true">Сохранённые разрешены</option><option value="false">Только ручной ввод</option></select>
      <input type="number" min={1} max={1000} placeholder="Макс. символов/сек" value={filters.maxCharactersPerSecond} onChange={event => setFilters({ ...filters, maxCharactersPerSecond: event.target.value })} />
      <input type="number" min={0} max={100000} placeholder="Макс. ставка" value={filters.maxStake} onChange={event => setFilters({ ...filters, maxStake: event.target.value })} />
    </div>
    <div className="room-list">{rooms.map(item => <article className="room-card" key={item.id}><div><h3>{item.name}</h3><small>создал @{item.creator.nickname} · {item.mapName}</small></div><div className="room-rules"><span>{item.allowClipboard ? 'Ctrl+C ✓' : 'Ctrl+C —'}</span><span>{item.allowPresetStrategies ? 'Свои стратегии ✓' : 'Только ввод'}</span><span>{item.maxCharactersPerSecond} симв/с</span><span>Карта: {item.mapName}</span><strong>◈ {item.stake}</strong></div><button className="primary" disabled={busy} onClick={() => void enter(item)}>Войти</button></article>)}{!rooms.length && <div className="ugc-empty"><b>Открытых комнат нет</b><p>Создай первую и задай правила боя.</p></div>}</div>

    {creating && <div className="ugc-modal-backdrop"><section className="ugc-modal"><button className="ugc-close" onClick={() => setCreating(false)}>×</button><p className="ugc-kicker">НОВАЯ КОМНАТА</p><h2>Правила боя</h2><div className="room-form"><label>Название<input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label>Карта<select value={form.mapId ?? ''} onChange={event => setForm({ ...form, mapId: event.target.value || null })}><option value="">Классическая арена</option>{maps.map(map => <option key={map.id} value={map.id}>{map.name} · {map.walls.length} препятствий</option>)}</select></label><label className="check-row"><input type="checkbox" checked={form.allowClipboard} onChange={event => setForm({ ...form, allowClipboard: event.target.checked })} /> Разрешить копирование, вырезание и вставку</label><label className="check-row"><input type="checkbox" checked={form.allowPresetStrategies} onChange={event => setForm({ ...form, allowPresetStrategies: event.target.checked })} /> Разрешить сохранённые стратегии</label><label>Символов в секунду<input type="number" min={1} max={1000} value={form.maxCharactersPerSecond} onChange={event => setForm({ ...form, maxCharactersPerSecond: Number(event.target.value) })} /></label><label>Ставка каждого<input type="number" min={0} max={100000} value={form.stake} onChange={event => setForm({ ...form, stake: Number(event.target.value) })} /></label></div><div className="ugc-actions"><button onClick={() => setCreating(false)}>Отмена</button><button className="primary" disabled={busy || !form.name.trim() || form.maxCharactersPerSecond < 1 || form.maxCharactersPerSecond > 1000 || form.stake < 0 || form.stake > 100000} onClick={() => void create()}>Создать</button></div></section></div>}

    {room && <div className="ugc-modal-backdrop"><section className="ugc-modal room-editor"><button className="ugc-close" disabled={waiting} onClick={() => setRoom(undefined)}>×</button><p className="ugc-kicker">КОМНАТА · @{room.creator.nickname}</p><h2>{room.name}</h2><div className="room-rules"><span>{room.allowClipboard ? 'Ctrl+C разрешён' : 'Ctrl+C запрещён'}</span><span>{room.allowPresetStrategies ? 'Сохранённые стратегии разрешены' : 'Только ручной ввод'}</span><span>{room.maxCharactersPerSecond} симв/с</span><span>Карта: {room.mapName}</span><strong>Ставка ◈ {room.stake}</strong></div>{room.allowPresetStrategies && <label>Активная сохранённая стратегия<select disabled={waiting || !!match} value={strategyId} onChange={event => void chooseStrategy(event.target.value)}><option value="">Ввести код вручную</option>{strategies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language === 'python' ? 'Python' : 'JavaScript'}</option>)}</select></label>}{!strategyId && <><label>Язык<select disabled={waiting || !!match} value={language} onChange={event => setLanguage(event.target.value as StrategyLanguage)}><option value="javascript">JavaScript</option><option value="python">Python</option></select></label><label>Код<textarea className="room-code" value={code} disabled={waiting || !!match} onCopy={event => { if (!room.allowClipboard) event.preventDefault(); }} onCut={event => { if (!room.allowClipboard) event.preventDefault(); }} onPaste={event => { if (!room.allowClipboard) event.preventDefault(); }} onChange={event => changeCode(event.target.value)} spellCheck={false} /></label></>}{match ? <div className="friend-replay"><ReplayPlayer replay={match.replay} /></div> : <button className="primary battle-start" disabled={busy || waiting || (!strategyId && !code.trim())} onClick={() => void ready()}>{waiting ? 'Ждём соперника…' : busy ? 'Проверяем…' : `Готов к бою за ◈ ${room.stake}`}</button>}<div className="ugc-actions"><button disabled={waiting} onClick={() => setRoom(undefined)}>Закрыть окно</button>{currentUserId === room.creator.id && <button className="danger-button" disabled={waiting || !!match} onClick={() => void cancel()}>Закрыть мою комнату</button>}</div></section></div>}
  </div>;
}
