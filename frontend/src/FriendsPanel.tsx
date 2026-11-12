import { useMounted } from './useMounted';
import { useEffect, useState } from 'react';
import type { BattleChallenge, FriendStrategy, Friendship, FriendUser, MatchResponse, StrategyTransfer, UgcStrategyCard } from './contracts';
import { ReplayPlayer } from './ReplayPlayer';
import { isUnauthorized, requireLogin, ugcApi } from './ugcApi';

export function FriendsPanel() {
  const mounted = useMounted();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [results, setResults] = useState<FriendUser[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [battleFriend, setBattleFriend] = useState<FriendUser>();
  const [mine, setMine] = useState<UgcStrategyCard[]>([]);
  const [theirs, setTheirs] = useState<FriendStrategy[]>([]);
  const [myStrategy, setMyStrategy] = useState('');
  const [theirStrategy, setTheirStrategy] = useState('');
  const [match, setMatch] = useState<MatchResponse>();
  const [busy, setBusy] = useState(false);
  const [challenges, setChallenges] = useState<BattleChallenge[]>([]);
  const [stake, setStake] = useState(10);
  const [accepting, setAccepting] = useState<BattleChallenge>();
  const [transfers, setTransfers] = useState<StrategyTransfer[]>([]);

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const timeout = setTimeout(() => {
      if (query.trim().length < 2) { setResults([]); return; }
      void ugcApi.searchUsers(query).then(setResults).catch(handleError);
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  function handleError(problem: unknown) {
    if (!mounted.current) return;
    if (isUnauthorized(problem)) requireLogin();
    else setError(problem instanceof Error ? problem.message : 'Не удалось выполнить действие.');
  }
  async function refresh() {
    try { const [friendItems, challengeItems, transferItems] = await Promise.all([ugcApi.friends(), ugcApi.challenges(), ugcApi.transfers()]); setFriends(friendItems); setChallenges(challengeItems); setTransfers(transferItems); setError(''); }
    catch (problem) { handleError(problem); }
  }
  async function add(user: FriendUser) {
    try { await ugcApi.addFriend(user.id); setResults(items => items.filter(item => item.id !== user.id)); await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function accept(friendship: Friendship) {
    try { await ugcApi.acceptFriend(friendship.id); await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function remove(friendship: Friendship) {
    try { await ugcApi.removeFriend(friendship.id); await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function prepareBattle(friend: FriendUser) {
    setBusy(true); setError(''); setMatch(undefined);
    try {
      const [myItems, theirItems] = await Promise.all([ugcApi.mine(), ugcApi.friendStrategies(friend.id)]);
      const activeItems = myItems.filter(item => item.isActive);
      setMine(activeItems); setTheirs(theirItems); setMyStrategy(activeItems[0]?.id ?? ''); setTheirStrategy(theirItems[0]?.id ?? '');
      setBattleFriend(friend);
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function fight() {
    if (!battleFriend || !myStrategy || !theirStrategy) return;
    setBusy(true); setError(''); setMatch(undefined);
    try { setMatch(await ugcApi.friendMatch(battleFriend.id, myStrategy, theirStrategy)); }
    catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function sendChallenge() {
    if (!battleFriend || !myStrategy) return;
    setBusy(true); setError('');
    try {
      await ugcApi.challengeFriend(battleFriend.id, myStrategy, stake);
      setBattleFriend(undefined); window.dispatchEvent(new Event('botarena-balance-changed')); await refresh();
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function openAccept(challenge: BattleChallenge) {
    setBusy(true); setError(''); setMatch(undefined);
    try {
      const myItems = (await ugcApi.mine()).filter(item => item.isActive); setMine(myItems); setMyStrategy(myItems[0]?.id ?? ''); setAccepting(challenge);
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function acceptWager() {
    if (!accepting || !myStrategy) return;
    setBusy(true); setError(''); setMatch(undefined);
    try {
      const result = await ugcApi.acceptChallenge(accepting.id, myStrategy); setMatch(result.match);
      window.dispatchEvent(new Event('botarena-balance-changed')); await refresh();
    } catch (problem) { handleError(problem); }
    finally { setBusy(false); }
  }
  async function decline(challenge: BattleChallenge) {
    try { await ugcApi.declineChallenge(challenge.id); await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function acceptTransfer(transfer: StrategyTransfer) {
    try { await ugcApi.acceptTransfer(transfer.id); window.dispatchEvent(new Event('botarena-strategies-changed')); await refresh(); }
    catch (problem) { handleError(problem); }
  }
  async function declineTransfer(transfer: StrategyTransfer) {
    try { await ugcApi.declineTransfer(transfer.id); await refresh(); }
    catch (problem) { handleError(problem); }
  }

  const accepted = friends.filter(item => item.status === 'accepted');
  const requests = friends.filter(item => item.status !== 'accepted');
  return <div className="friends-panel">
    <div className="ugc-section-head"><div><h2>Друзья и дуэли</h2><p>Находи пилотов по нику и сражайся с их опубликованными стратегиями.</p></div></div>
    {error && <p className="error-card">{error}</p>}
    <div className="friend-search"><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти по нику…" />{results.map(user => <div className="friend-row" key={user.id}><Avatar user={user} /><b>@{user.nickname}</b><button onClick={() => void add(user)}>Добавить</button></div>)}</div>
    {!!transfers.length && <section className="friend-section"><h3>Полученные стратегии</h3>{transfers.map(item => <div className="friend-row" key={item.id}><Avatar user={item.sender} /><div><b>{item.strategy.name}</b><small>@{item.sender.nickname} отправил отдельную копию · {item.strategy.language === 'python' ? 'Python' : 'JavaScript'}</small></div><span className="friend-spacer" /><button className="primary" onClick={() => void acceptTransfer(item)}>Принять</button><button onClick={() => void declineTransfer(item)}>Отклонить</button></div>)}</section>}
    {!!challenges.filter(item => item.status === 'Pending').length && <section className="friend-section"><h3>Вызовы на ставку</h3>{challenges.filter(item => item.status === 'Pending').map(item => { const rival = item.incoming ? item.challenger : item.opponent; return <div className="friend-row" key={item.id}><Avatar user={rival} /><div><b>@{rival.nickname}</b><small>{item.incoming ? 'Вызывает вас' : 'Ожидает ответа'} · ставка каждого ◈ {item.stake}</small></div><span className="friend-spacer" />{item.incoming && <><button className="primary" onClick={() => void openAccept(item)}>Принять</button><button onClick={() => void decline(item)}>Отклонить</button></>}</div>; })}</section>}
    {!!requests.length && <section className="friend-section"><h3>Заявки</h3>{requests.map(item => <div className="friend-row" key={item.id}><Avatar user={item.user} /><div><b>@{item.user.nickname}</b><small>{item.status === 'incoming' ? 'Хочет добавить вас в друзья' : 'Заявка отправлена'}</small></div><span className="friend-spacer" />{item.status === 'incoming' && <button className="primary" onClick={() => void accept(item)}>Принять</button>}<button onClick={() => void remove(item)}>{item.status === 'incoming' ? 'Отклонить' : 'Отменить'}</button></div>)}</section>}
    <section className="friend-section"><h3>Мои друзья</h3>{accepted.map(item => <div className="friend-row" key={item.id}><Avatar user={item.user} /><b>@{item.user.nickname}</b><span className="friend-spacer" /><button className="primary" disabled={busy} onClick={() => void prepareBattle(item.user)}>Сразиться</button><button title="Удалить из друзей" onClick={() => void remove(item)}>×</button></div>)}{!accepted.length && <div className="ugc-empty"><b>Здесь пока никого</b><p>Найди пилота по уникальному нику и отправь заявку.</p></div>}</section>
    {battleFriend && <div className="ugc-modal-backdrop"><section className="ugc-modal friend-battle"><button className="ugc-close" onClick={() => setBattleFriend(undefined)}>×</button><p className="ugc-kicker">ДРУЖЕСКАЯ ДУЭЛЬ</p><h2>Бой против @{battleFriend.nickname}</h2><div className="battle-pickers"><label>Моя стратегия<select value={myStrategy} onChange={event => setMyStrategy(event.target.value)}>{mine.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><span>VS</span><label>Стратегия друга<select value={theirStrategy} onChange={event => setTheirStrategy(event.target.value)}>{theirs.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>{!mine.length && <p className="error-card">Сначала сохраните свою стратегию.</p>}<div className="wager-box"><label>Ставка каждого<input type="number" min={1} max={100000} value={stake} onChange={event => setStake(Number(event.target.value))} /></label><button className="primary" disabled={busy || !myStrategy || stake < 1} onClick={() => void sendChallenge()}>Отправить вызов на ◈ {stake}</button></div>{!theirs.length && <p className="muted">Для мгновенного бесплатного боя другу нужна публичная стратегия.</p>}<button className="battle-start" disabled={busy || !myStrategy || !theirStrategy} onClick={() => void fight()}>{busy ? 'Рассчитываем бой…' : 'Бесплатная дуэль сейчас'}</button>{match && <div className="friend-replay"><ReplayPlayer replay={match.replay} /></div>}</section></div>}
    {accepting && <div className="ugc-modal-backdrop"><section className="ugc-modal friend-battle"><button className="ugc-close" onClick={() => setAccepting(undefined)}>×</button><p className="ugc-kicker">ВЫЗОВ НА СТАВКУ</p><h2>@{accepting.challenger.nickname} · ◈ {accepting.stake} с каждого</h2><p>При принятии с обоих балансов спишется по {accepting.stake} кредитов. Победитель получит {accepting.stake * 2}.</p><label>Моя стратегия<select value={myStrategy} onChange={event => setMyStrategy(event.target.value)}>{mine.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="primary battle-start" disabled={busy || !myStrategy || !!match} onClick={() => void acceptWager()}>{busy ? 'Рассчитываем бой…' : `Принять за ◈ ${accepting.stake}`}</button>{match && <div className="friend-replay"><ReplayPlayer replay={match.replay} /></div>}</section></div>}
  </div>;
}

function Avatar({ user }: { user: FriendUser }) {
  return user.avatarUrl ? <img className="friend-avatar" src={user.avatarUrl} alt="" /> : <span className="friend-avatar fallback">{user.nickname?.[0] ?? '?'}</span>;
}
