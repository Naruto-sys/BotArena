import { useMounted } from './useMounted';
import { useEffect, useRef, useState } from 'react';
import type { BattleMap, GameRoom, RoomDetails, MatchResponse, StrategyLanguage, UgcStrategyCard } from './contracts';
import { ArenaModal } from './ArenaModal';
import { roomText } from './text';
import { ReplayPlayer } from './ReplayPlayer';
import { isUnauthorized, requireLogin, type CreateRoom, ugcApi } from './ugcApi';

const initialRoom: CreateRoom = {
  name: '', allowClipboard: true, allowPresetStrategies: true,
  maxCharactersPerSecond: 20, stake: 0, mapId: null, isPrivate: false, password: '',
};

export function RoomsPanel() {
  const mounted = useMounted();
  const [mine, setMine] = useState<GameRoom[]>([]);
  const [invite, setInvite] = useState(location.hash.split('/')[2] ?? '');
  const [invitePassword, setInvitePassword] = useState('');
  const [inviteOpen, setInviteOpen] = useState(location.hash.split('/')[2] !== undefined);
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
  const [matchRound, setMatchRound] = useState(0);
  const [showReplay, setShowReplay] = useState(false);
  const [readyCount, setReadyCount] = useState(0);
  const matchRoundRef = useRef(0);
  const roomRef = useRef<GameRoom | undefined>(undefined);
  const operationEpoch = useRef(0);
  const busyRef = useRef(false);
  busyRef.current = busy;
  const [currentUserId, setCurrentUserId] = useState('');
  const inputTimes = useRef<number[]>([]);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => { void refresh(); void ugcApi.maps().then(setMaps).catch(handleError); }, [filters.clipboard, filters.presets, filters.maxCharactersPerSecond, filters.maxStake]);
  useEffect(() => {
    if (!room || room.status === 'Cancelled') return;
    const roomId = room.id;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const epoch = operationEpoch.current;
      try {
        if (!busyRef.current) {
          const result = await ugcApi.room(roomId, matchRoundRef.current);
          if (!disposed && epoch === operationEpoch.current && mounted.current) applyDetails(result);
        }
      } catch (problem) { if (!disposed && epoch === operationEpoch.current) handleError(problem); }
      finally { if (!disposed) timer = setTimeout(poll, 1500); }
    }
    timer = setTimeout(poll, 1500);
    return () => { disposed = true; clearTimeout(timer); };
  }, [room?.id, room?.status === 'Cancelled']);

  function applyDetails(result: RoomDetails) {
    const current = roomRef.current;
    if (current && (result.room.id !== current.id || result.room.roundNumber < current.roundNumber)) return;
    const advanced = current && result.room.roundNumber > current.roundNumber;
    roomRef.current = result.room;
    setRoom(result.room); setReadyCount(result.readyCount);
    setWaiting(result.room.status === 'Running' || (result.room.status === 'Open' && !!result.draft?.isReady));
    if (result.match && result.matchRoundNumber && result.matchRoundNumber > matchRoundRef.current) {
      matchRoundRef.current = result.matchRoundNumber;
      setMatchRound(result.matchRoundNumber); setMatch(result.match); setShowReplay(false);
      window.dispatchEvent(new Event('botarena-balance-changed'));
    }
    if (advanced) {
      inputTimes.current = [];
      setNotice(roomText.nextRound);
    }
    if (result.room.status === 'Cancelled') {
      setMine(items => items.filter(item => item.id !== result.room.id));
      setNotice(roomText.closedNotice);
    } else setMine(items => items.map(item => item.id === result.room.id ? result.room : item));
  }

  function closeRoom() {
    operationEpoch.current++;
    roomRef.current = undefined; setRoom(undefined); setWaiting(false); setBusy(false);
  }

  function handleError(problem: unknown) {
    if (!mounted.current) return;
    if (isUnauthorized(problem)) requireLogin();
    else setError(problem instanceof Error ? problem.message : 'Не удалось выполнить действие.');
  }
  async function refresh() {
    try { const [available, active, session] = await Promise.all([ugcApi.rooms(filters), ugcApi.myRooms(), ugcApi.session()]); if (!mounted.current) return; setRooms(available); setMine(active); if (session.authenticated) setCurrentUserId(session.user.id); setError(''); }
    catch (problem) { handleError(problem); }
  }
  async function enter(next: GameRoom, alreadyJoined = false) {
    const epoch = ++operationEpoch.current;
    roomRef.current = undefined; matchRoundRef.current = 0;
    setBusy(true); setError(''); setNotice(''); setMatch(undefined); setMatchRound(0); setShowReplay(false); setWaiting(false);
    inputTimes.current = [];
    try {
      await draftQueue.current.catch(() => undefined);
      const session = await ugcApi.session();
      if (session.authenticated) setCurrentUserId(session.user.id);
      const joined = alreadyJoined || (session.authenticated && session.user.id === next.creator.id) ? next : await ugcApi.joinRoom(next.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      const details = await ugcApi.room(joined.id);
      if (!mounted.current || epoch !== operationEpoch.current) return;
      setStrategies(mine); setStrategyId(details.draft?.sourceStrategyId ?? ''); setCode(details.draft?.code ?? ''); setLanguage(details.draft?.language ?? 'javascript'); applyDetails(details);
      await refresh();
    } catch (problem) { handleError(problem); }
    finally { if (epoch === operationEpoch.current) setBusy(false); }
  }
  async function create() {
    if ((form.isPrivate && (form.password.length < 4 || form.password.length > 128)) || !form.name.trim() || form.maxCharactersPerSecond < 1 || form.maxCharactersPerSecond > 1000 || form.stake < 0 || form.stake > 100000) return;
    setBusy(true); setError('');
    try {
      draftQueue.current = Promise.resolve();
      const created = await ugcApi.createRoom(form);
      const session = await ugcApi.session(); if (session.authenticated) setCurrentUserId(session.user.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      operationEpoch.current++; roomRef.current = created; matchRoundRef.current = 0;
      setStrategies(mine); setRoom(created); setCreating(false); setForm(initialRoom); setCode(''); setStrategyId(''); setWaiting(false); setMatch(undefined); setMatchRound(0); setShowReplay(false); setReadyCount(0);
      await refresh();
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function joinInvite() {
    const id = invite.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];
    if (!id) { setError('Укажите ссылку или корректный код комнаты.'); return; }
    setBusy(true); setError('');
    try { const joined = await ugcApi.joinRoom(id, invitePassword); setInvitePassword(''); setInviteOpen(false); await enter(joined, true); }
    catch (problem) { handleError(problem); }
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
    // Serialize all mutations so an earlier manual edit cannot replace a selected strategy.
    const save = draftQueue.current.catch(() => undefined)
      .then(() => ugcApi.updateRoomDraft(room.id, { code: next, language, roundNumber: room.roundNumber }))
      .then(() => undefined);
    draftQueue.current = save;
    void save.catch(handleError);
  }
  async function chooseStrategy(id: string) {
    if (!room) return;
    setStrategyId(id); setError('');
    if (!id) return;
    const selected = strategies.find(item => item.id === id);
    if (selected) setLanguage(selected.language);
    const save = draftQueue.current.catch(() => undefined)
      .then(() => ugcApi.updateRoomDraft(room.id, { code: '', language: selected?.language ?? language, strategyId: id, roundNumber: room.roundNumber }))
      .then(() => undefined);
    draftQueue.current = save;
    try { await save; setNotice('Сохранённая стратегия выбрана.'); }
    catch (problem) { handleError(problem); }
  }

  async function ready() {
    if (!room) return;
    const epoch = ++operationEpoch.current;
    setBusy(true); setError(''); setNotice('');
    try {
      // A rejected save from a previous round must not poison this round's queue.
      // Re-submit the current choice and validate it before marking ready.
      await draftQueue.current.catch(() => undefined);
      await ugcApi.updateRoomDraft(room.id, { code, language, roundNumber: room.roundNumber, strategyId: strategyId || undefined });
      await ugcApi.readyRoom(room.id, room.roundNumber);
      const result = await ugcApi.room(room.id, matchRoundRef.current);
      if (!mounted.current || epoch !== operationEpoch.current) return;
      applyDetails(result);
      if (result.room.roundNumber === room.roundNumber && result.draft?.isReady)
        setNotice(roomText.accepted);
    } catch (problem) { if (epoch === operationEpoch.current) handleError(problem); }
    finally { if (epoch === operationEpoch.current) setBusy(false); }
  }
  async function continueRoom() {
    if (!room) return;
    const epoch = ++operationEpoch.current;
    setBusy(true); setError('');
    try {
      await ugcApi.nextRoomRound(room.id, room.roundNumber);
      const result = await ugcApi.room(room.id, matchRoundRef.current);
      if (mounted.current && epoch === operationEpoch.current) { applyDetails(result); await refresh(); }
    } catch (problem) { if (epoch === operationEpoch.current) handleError(problem); }
    finally { if (epoch === operationEpoch.current) setBusy(false); }
  }
  async function cancel(target = room) {
    if (!target) return;
    try { await ugcApi.cancelRoom(target.id); if (room?.id === target.id) closeRoom(); await refresh(); }
    catch (problem) { handleError(problem); }
  }

  const ownActive = mine.find(item => item.creator.id === currentUserId && (item.status === 'Open' || item.status === 'Running'));
  const winner = match?.replay.result.winnerBotId;
  const outcome = !winner ? roomText.draw : (winner === 'player') === (currentUserId === room?.creator.id) ? roomText.win : roomText.loss;
  const roomLink = room ? `${location.origin}/#arena/rooms/${room.id}` : '';
  return <div className="rooms-panel">
    <div className="ugc-section-head"><div><h2>Игровые комнаты</h2><p>Выберите карту и соперника. Создатель может держать одну активную комнату.</p></div><div className="room-toolbar-actions"><button onClick={() => setInviteOpen(true)}>Войти по приглашению</button><button className="primary" disabled={!!ownActive} onClick={() => { setError(''); setCreating(true); }}>+ Создать комнату</button></div></div>
    {error && <p role="alert" className="error-card">{error}</p>}{notice && <p role="status" className="ugc-notice">{notice}</p>}
    <details className="room-advanced"><summary>Фильтры открытых комнат</summary><div className="room-filters">
      <select aria-label="Копирование" value={filters.clipboard} onChange={event => setFilters({ ...filters, clipboard: event.target.value })}><option value="">Копирование: любое</option><option value="true">Разрешено</option><option value="false">Запрещено</option></select>
      <select aria-label="Сохранённые стратегии" value={filters.presets} onChange={event => setFilters({ ...filters, presets: event.target.value })}><option value="">Стратегии: любые</option><option value="true">Сохранённые разрешены</option><option value="false">Только ручной ввод</option></select>
      <input aria-label="Максимум символов в секунду" type="number" min={1} max={1000} placeholder="Макс. символов/сек" value={filters.maxCharactersPerSecond} onChange={event => setFilters({ ...filters, maxCharactersPerSecond: event.target.value })} />
      <input aria-label="Максимальная ставка" type="number" min={0} max={100000} placeholder="Макс. ставка" value={filters.maxStake} onChange={event => setFilters({ ...filters, maxStake: event.target.value })} />
    </div></details>
    {mine.length > 0 && <section className="my-rooms"><h3>Ваши активные комнаты</h3>{mine.map(item => <div className="room-card" key={item.id}><div><h3>{item.name}</h3><small>{item.isPrivate ? 'Приватная' : 'Публичная'} · {item.status === 'Running' ? 'Идёт расчёт' : item.status === 'Completed' ? 'Завершена · можно продолжить' : `Ожидание · раунд ${item.roundNumber}`}</small></div><span>{item.mapName}</span><div className="room-row-actions"><button className="room-icon-button" aria-label="Открыть комнату" title="Открыть комнату" onClick={() => void enter(item, true)}><RoomIcon kind="edit" /></button>{item.creator.id === currentUserId && item.status !== 'Completed' && <button className="room-icon-button danger-button" aria-label="Удалить комнату" title={item.status === 'Running' ? 'Дождитесь завершения матча' : 'Удалить комнату'} disabled={item.status === 'Running'} onClick={() => void cancel(item)}><RoomIcon kind="delete" /></button>}</div></div>)}</section>}
    <div className="room-list">{rooms.filter(item => !mine.some(active => active.id === item.id)).map(item => <article className="room-card" key={item.id}><div><h3>{item.name}</h3><small>создал @{item.creator.nickname}</small></div><div className="room-rules"><span>{item.mapName}</span><strong>◈ {item.stake}</strong></div><button className="primary" disabled={busy} onClick={() => void enter(item)}>Войти</button></article>)}{!rooms.filter(item => !mine.some(active => active.id === item.id)).length && <div className="ugc-empty"><b>Открытых комнат нет</b><p>Создайте публичную комнату или войдите по приглашению.</p></div>}</div>
    {inviteOpen && <ArenaModal title="Войти по приглашению" onClose={() => setInviteOpen(false)}><div className="room-form"><label>Ссылка или код комнаты<input value={invite} onChange={event => setInvite(event.target.value)} /></label><label>Пароль комнаты<input type="password" maxLength={128} autoComplete="off" value={invitePassword} onChange={event => setInvitePassword(event.target.value)} /></label><button disabled={busy || !invite.trim()} onClick={() => void joinInvite()}>Войти по приглашению</button></div>{error && <p role="alert" className="error-card">{error}</p>}</ArenaModal>}
    {creating && <ArenaModal title="Новая комната" onClose={() => { if (!busy) setCreating(false); }}>
      <div className="room-form"><label>Название<input required maxLength={80} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label>Карта<select value={form.mapId ?? ''} onChange={event => setForm({ ...form, mapId: event.target.value || null })}><option value="">Классическая арена</option>{maps.map(map => <option key={map.id} value={map.id}>{map.name} · {map.walls.length} препятствий</option>)}</select></label>
        <label>Видимость<select value={form.isPrivate ? 'private' : 'public'} onChange={event => setForm({ ...form, isPrivate: event.target.value === 'private', password: '' })}><option value="public">Публичная — видна в списке</option><option value="private">Приватная — по приглашению и паролю</option></select></label>
        {form.isPrivate && <label>Пароль комнаты<input type="password" minLength={4} maxLength={128} autoComplete="new-password" value={form.password} onChange={event => setForm({ ...form, password: event.target.value })} /><small>От 4 до 128 символов. Передайте пароль сопернику отдельно от ссылки.</small></label>}
        <details className="room-advanced"><summary>Дополнительные настройки</summary><div className="room-form">
          <label className="check-row"><input type="checkbox" checked={form.allowClipboard} onChange={event => setForm({ ...form, allowClipboard: event.target.checked })} /> Разрешить копирование, вырезание и вставку</label>
          <label className="check-row"><input type="checkbox" checked={form.allowPresetStrategies} onChange={event => setForm({ ...form, allowPresetStrategies: event.target.checked })} /> Разрешить сохранённые стратегии</label>
          <label>Символов в секунду<input type="number" min={1} max={1000} value={form.maxCharactersPerSecond} onChange={event => setForm({ ...form, maxCharactersPerSecond: Number(event.target.value) })} /></label>
          <label>Ставка каждого<input type="number" min={0} max={100000} value={form.stake} onChange={event => setForm({ ...form, stake: Number(event.target.value) })} /></label>
        </div></details>
        {error && <p role="alert" className="error-card">{error}</p>}
        <div className="ugc-actions"><button disabled={busy} onClick={() => setCreating(false)}>Отмена</button><button className="primary" disabled={busy || !form.name.trim() || (form.isPrivate && (form.password.length < 4 || form.password.length > 128)) || !Number.isFinite(form.maxCharactersPerSecond) || form.maxCharactersPerSecond < 1 || form.maxCharactersPerSecond > 1000 || !Number.isFinite(form.stake) || form.stake < 0 || form.stake > 100000} onClick={() => void create()}>{busy ? 'Создаём…' : 'Создать комнату'}</button></div>
      </div>
    </ArenaModal>}
    {room && <ArenaModal title={room.name} wide onClose={closeRoom}>
      <div className="room-editor"><div className="room-rules"><span>{room.isPrivate ? 'Приватная комната' : 'Публичная комната'}</span><span>{room.mapName}</span><strong>Ставка ◈ {room.stake}</strong></div>
        <label>Приглашение<input readOnly value={roomLink} onFocus={event => event.target.select()} /></label>
        {room.isPrivate && <p className="muted">Ссылка не содержит пароль. Передайте его сопернику отдельно.</p>}
        {room.allowPresetStrategies && strategies.length > 1 && <label>Сохранённая стратегия<select disabled={busy || waiting || room.status !== 'Open'} value={strategyId} onChange={event => void chooseStrategy(event.target.value)}><option value="">Ввести код вручную</option>{strategies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language === 'python' ? 'Python' : 'JavaScript'}</option>)}</select></label>}
        {room.allowPresetStrategies && strategies.length === 1 && <div className="single-strategy"><span>Сохранена: {strategies[0].name}</span><button disabled={busy || waiting || room.status !== 'Open'} onClick={() => void chooseStrategy(strategyId ? '' : strategies[0].id)}>{strategyId ? 'Ввести код вручную' : 'Использовать стратегию'}</button></div>}
        {room.allowPresetStrategies && strategies.length === 0 && <p className="muted">Сохранённых стратегий пока нет. Введите код ниже.</p>}
        {!strategyId && <><label>Язык<select disabled={busy || waiting || room.status !== 'Open'} value={language} onChange={event => setLanguage(event.target.value as StrategyLanguage)}><option value="javascript">JavaScript</option><option value="python">Python</option></select></label><label>Код<textarea className="room-code" value={code} disabled={busy || waiting || room.status !== 'Open'} onCopy={event => { if (!room.allowClipboard) event.preventDefault(); }} onCut={event => { if (!room.allowClipboard) event.preventDefault(); }} onPaste={event => { if (!room.allowClipboard) event.preventDefault(); }} onChange={event => changeCode(event.target.value)} spellCheck={false} /></label></>}
        {error && <p role="alert" className="error-card">{error}</p>}{notice && <p role="status" className="ugc-notice">{notice}</p>}
        <p className="room-round-status" role="status"><strong>{roomText.round(room.roundNumber)}</strong><span>{room.status === 'Running' ? roomText.calculating : room.status === 'Cancelled' ? roomText.closed : room.status === 'Completed' ? roomText.completed : !room.occupied ? roomText.waitingGuest : roomText.readyCount(readyCount, waiting)}</span></p>
        {room.status === 'Completed' ? <button className="primary battle-start" disabled={busy} onClick={() => void continueRoom()}>{roomText.continue}</button> : <button className="primary battle-start" disabled={busy || waiting || room.status !== 'Open' || (!strategyId && !code.trim())} onClick={() => void ready()}>{room.status === 'Cancelled' ? roomText.closed : waiting ? roomText.waiting : busy ? 'Проверяем…' : roomText.ready(room.roundNumber, room.stake)}</button>}
        {match && <section className="room-last-match"><strong>{roomText.result(matchRound, outcome)}</strong><button type="button" aria-expanded={showReplay} onClick={() => setShowReplay(!showReplay)}>{showReplay ? roomText.hideRecord : roomText.record(matchRound)}</button>{showReplay && <ReplayPlayer key={matchRound} replay={match.replay} />}</section>}
        <div className="ugc-actions"><button onClick={closeRoom}>Закрыть окно</button>{currentUserId === room.creator.id && room.status !== 'Completed' && <button className="danger-button" disabled={room.status !== 'Open'} onClick={() => void cancel()}>Закрыть мою комнату</button>}</div>
      </div>
    </ArenaModal>}
  </div>;
}

function RoomIcon({ kind }: { kind: 'edit' | 'delete' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'edit' ? <><path d="m15 4 5 5M4 16 16 4a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /><path d="M12 21h9" /></> : <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>}</svg>;
}
