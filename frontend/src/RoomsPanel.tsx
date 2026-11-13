import { useMounted } from './useMounted';
import { useEffect, useRef, useState } from 'react';
import type { BattleMap, GameRoom, MatchResponse, StrategyLanguage, UgcStrategyCard } from './contracts';
import { ArenaModal } from './ArenaModal';
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
  const [currentUserId, setCurrentUserId] = useState('');
  const inputTimes = useRef<number[]>([]);
  const draftQueue = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => { void refresh(); void ugcApi.maps().then(setMaps).catch(handleError); }, [filters.clipboard, filters.presets, filters.maxCharactersPerSecond, filters.maxStake]);
  useEffect(() => {
    if (!waiting || !room) return;
    const timer = setInterval(() => {
      void ugcApi.room(room.id).then(result => {
        setRoom(result.room);
        if (result.room.status === 'Cancelled') {
          setWaiting(false); setMine(items => items.filter(item => item.id !== result.room.id));
          setNotice('Комната закрыта создателем. Можно выбрать другую комнату.');
        }
        if (result.match) { setMatch(result.match); setMine(items => items.filter(item => item.id !== result.room.id)); setWaiting(false); window.dispatchEvent(new Event('botarena-balance-changed')); }
      }).catch(handleError);
    }, 1500);
    return () => clearInterval(timer);
  }, [waiting, room?.id]);

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
    setBusy(true); setError(''); setNotice(''); setMatch(undefined); setWaiting(false);
    inputTimes.current = [];
    try {
      await draftQueue.current.catch(() => undefined);
      const session = await ugcApi.session();
      if (session.authenticated) setCurrentUserId(session.user.id);
      const joined = alreadyJoined || (session.authenticated && session.user.id === next.creator.id) ? next : await ugcApi.joinRoom(next.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      const details = await ugcApi.room(joined.id);
      setStrategies(mine); setStrategyId(details.draft?.sourceStrategyId ?? ''); setCode(details.draft?.code ?? ''); setLanguage(details.draft?.language ?? 'javascript'); setRoom(details.room); setMatch(details.match ?? undefined); setWaiting(details.room.status === 'Running' || (details.room.status === 'Open' && !!details.draft?.isReady && !details.match));
      await refresh();
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function create() {
    if ((form.isPrivate && (form.password.length < 4 || form.password.length > 128)) || !form.name.trim() || form.maxCharactersPerSecond < 1 || form.maxCharactersPerSecond > 1000 || form.stake < 0 || form.stake > 100000) return;
    setBusy(true); setError('');
    try {
      draftQueue.current = Promise.resolve();
      const created = await ugcApi.createRoom(form);
      const session = await ugcApi.session(); if (session.authenticated) setCurrentUserId(session.user.id);
      const mine = (await ugcApi.mine()).filter(item => item.isActive);
      setStrategies(mine); setRoom(created); setCreating(false); setForm(initialRoom); setCode(''); setStrategyId(''); setWaiting(false); setMatch(undefined);
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
      .then(() => ugcApi.updateRoomDraft(room.id, { code: next, language }))
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
      .then(() => ugcApi.updateRoomDraft(room.id, { code: '', language: selected?.language ?? language, strategyId: id }))
      .then(() => undefined);
    draftQueue.current = save;
    try { await save; setNotice('Сохранённая стратегия выбрана.'); }
    catch (problem) { handleError(problem); }
  }

  async function ready() {
    if (!room) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await draftQueue.current;
      if (!strategyId) await ugcApi.updateRoomDraft(room.id, { code, language });
      const result = await ugcApi.readyRoom(room.id);
      if (result.match) { setMatch(result.match); setMine(items => items.filter(item => item.id !== room.id)); window.dispatchEvent(new Event('botarena-balance-changed')); }
      else { setWaiting(true); setNotice('Стратегия принята. Ждём второго игрока…'); }
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function cancel(target = room) {
    if (!target) return;
    try { await ugcApi.cancelRoom(target.id); if (room?.id === target.id) { setRoom(undefined); setWaiting(false); } await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function cancelWaiting() {
    if (!room || !waiting) return;
    setBusy(true); setError('');
    try {
      await ugcApi.cancelRoomWaiting(room.id);
      setWaiting(false); setNotice('Ожидание отменено. Код снова можно редактировать.');
      const details = await ugcApi.room(room.id);
      setRoom(details.room);
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }

  const ownActive = mine.find(item => item.creator.id === currentUserId);
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
    {mine.length > 0 && <section className="my-rooms"><h3>Ваши активные комнаты</h3>{mine.map(item => <div className="room-card" key={item.id}><div><h3>{item.name}</h3><small>{item.isPrivate ? 'Приватная' : 'Публичная'} · {item.status === 'Running' ? 'Идёт расчёт' : 'Ожидание'}</small></div><span>{item.mapName}</span><div className="room-row-actions"><button className="room-icon-button" aria-label="Открыть комнату" title="Открыть комнату" onClick={() => void enter(item, true)}><RoomIcon kind="edit" /></button>{item.creator.id === currentUserId && <button className="room-icon-button danger-button" aria-label="Удалить комнату" title={item.status === 'Running' ? 'Дождитесь завершения матча' : 'Удалить комнату'} disabled={item.status === 'Running'} onClick={() => void cancel(item)}><RoomIcon kind="delete" /></button>}</div></div>)}</section>}
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
    {room && <ArenaModal title={room.name} wide onClose={() => setRoom(undefined)}>
      <div className="room-editor"><div className="room-rules"><span>{room.isPrivate ? 'Приватная комната' : 'Публичная комната'}</span><span>{room.mapName}</span><strong>Ставка ◈ {room.stake}</strong></div>
        <label>Приглашение<input readOnly value={roomLink} onFocus={event => event.target.select()} /></label>
        {room.isPrivate && <p className="muted">Ссылка не содержит пароль. Передайте его сопернику отдельно.</p>}
        {room.allowPresetStrategies && strategies.length > 1 && <label>Сохранённая стратегия<select disabled={waiting || !!match || room.status !== 'Open'} value={strategyId} onChange={event => void chooseStrategy(event.target.value)}><option value="">Ввести код вручную</option>{strategies.map(item => <option key={item.id} value={item.id}>{item.name} · {item.language === 'python' ? 'Python' : 'JavaScript'}</option>)}</select></label>}
        {room.allowPresetStrategies && strategies.length === 1 && <div className="single-strategy"><span>Сохранена: {strategies[0].name}</span><button disabled={waiting || !!match || room.status !== 'Open'} onClick={() => void chooseStrategy(strategyId ? '' : strategies[0].id)}>{strategyId ? 'Ввести код вручную' : 'Использовать стратегию'}</button></div>}
        {room.allowPresetStrategies && strategies.length === 0 && <p className="muted">Сохранённых стратегий пока нет. Введите код ниже.</p>}
        {!strategyId && <><label>Язык<select disabled={waiting || !!match || room.status !== 'Open'} value={language} onChange={event => setLanguage(event.target.value as StrategyLanguage)}><option value="javascript">JavaScript</option><option value="python">Python</option></select></label><label>Код<textarea className="room-code" value={code} disabled={waiting || !!match || room.status !== 'Open'} onCopy={event => { if (!room.allowClipboard) event.preventDefault(); }} onCut={event => { if (!room.allowClipboard) event.preventDefault(); }} onPaste={event => { if (!room.allowClipboard) event.preventDefault(); }} onChange={event => changeCode(event.target.value)} spellCheck={false} /></label></>}
        {error && <p role="alert" className="error-card">{error}</p>}{notice && <p role="status" className="ugc-notice">{notice}</p>}
        {match ? <ReplayPlayer replay={match.replay} /> : waiting
          ? <button className="danger-button battle-start" disabled={busy || room.status !== 'Open'} onClick={() => void cancelWaiting()}>{busy ? 'Отменяем…' : 'Отменить ожидание'}</button>
          : <button className="primary battle-start" disabled={busy || room.status !== 'Open' || (!strategyId && !code.trim())} onClick={() => void ready()}>{room.status === 'Cancelled' ? 'Комната закрыта' : busy ? 'Проверяем…' : `Готов к бою за ◈ ${room.stake}`}</button>}
        <div className="ugc-actions"><button onClick={() => setRoom(undefined)}>Закрыть окно</button>{currentUserId === room.creator.id && <button className="danger-button" disabled={room.status !== 'Open' || !!match} onClick={() => void cancel()}>Закрыть мою комнату</button>}</div>
      </div>
    </ArenaModal>}
  </div>;
}

function RoomIcon({ kind }: { kind: 'edit' | 'delete' }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind === 'edit' ? <><path d="m15 4 5 5M4 16 16 4a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /><path d="M12 21h9" /></> : <><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" /></>}</svg>;
}
