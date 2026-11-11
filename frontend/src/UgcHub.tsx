import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type { Friendship, ManeuverSnippet, StrategyLanguage, UgcStrategy, UgcStrategyCard } from './contracts';
import { isUnauthorized, login, type SaveStrategy, ugcApi } from './ugcApi';
import { FriendsPanel } from './FriendsPanel';
import { RoomsPanel } from './RoomsPanel';
import { BattleMapEditor } from './BattleMapEditor';

type Section = 'catalog' | 'mine' | 'maneuvers' | 'friends' | 'rooms' | 'maps';
const starter: SaveStrategy = {
  name: '', description: '', language: 'javascript', tags: [],
  salePrice: null,
  code: 'function tick({ self, enemy }) {\n  // Твоя тактика начинается здесь\n  return {};\n}',
};

export function UgcHub() {
  const [section, setSection] = useState<Section>('catalog');
  const [cards, setCards] = useState<UgcStrategyCard[]>([]);
  const [maneuvers, setManeuvers] = useState<ManeuverSnippet[]>([]);
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('');
  const [sort, setSort] = useState('popular');
  const [category, setCategory] = useState('');
  const [detail, setDetail] = useState<UgcStrategy>();
  const [editing, setEditing] = useState<UgcStrategy | 'new'>();
  const [draft, setDraft] = useState<SaveStrategy>(starter);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [publishing, setPublishing] = useState<UgcStrategy>();
  const [paid, setPaid] = useState(false);
  const [publishPrice, setPublishPrice] = useState(10);
  const [sending, setSending] = useState<UgcStrategy>();
  const [friends, setFriends] = useState<Friendship[]>([]);

  useEffect(() => { void load(); }, [section, query, language, sort, category]);
  useEffect(() => {
    const token = new URLSearchParams(location.search).get('share');
    if (token) void ugcApi.shared(token).then(setDetail).catch(showError);
  }, []);

  async function load() {
    try {
      if (section === 'catalog') setCards(await ugcApi.catalog(query, language, sort));
      else if (section === 'mine') setCards(await ugcApi.mine());
      else if (section === 'maneuvers') setManeuvers(await ugcApi.maneuvers(category));
      setError('');
    } catch (problem) {
      if (isUnauthorized(problem)) login(); else showError(problem);
    }
  }
  function showError(problem: unknown) { setError(problem instanceof Error ? problem.message : 'Что-то пошло не так.'); }
  async function open(id: string) { try { setDetail(await ugcApi.strategy(id)); } catch (problem) { showError(problem); } }
  function newStrategy() { setDraft({ ...starter }); setEditing('new'); }
  function edit(strategy: UgcStrategy) {
    if (!strategy.code) { setError('Исходный код платной стратегии доступен после покупки.'); return; }
    setDraft({ name: strategy.name, description: strategy.description, language: strategy.language, code: strategy.code, tags: strategy.tags, salePrice: strategy.salePrice });
    setDetail(undefined); setEditing(strategy);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (editing === 'new') await ugcApi.create(draft); else if (editing) await ugcApi.update(editing.id, draft);
      const updated = await ugcApi.mine();
      setCards(updated); setEditing(undefined); setSection('mine');
      window.dispatchEvent(new Event('botarena-strategies-changed'));
    } catch (problem) { if (isUnauthorized(problem)) login(); else showError(problem); }
    finally { setBusy(false); }
  }
  async function publish() {
    if (!publishing) return; setBusy(true);
    try {
      const published = await ugcApi.publish(publishing.id, paid, paid ? publishPrice : null);
      setDetail(published); setPublishing(undefined); setCards(await ugcApi.mine());
    } catch (problem) { showError(problem); } finally { setBusy(false); }
  }
  async function unpublish(strategy: UgcStrategy) {
    setBusy(true); try { await ugcApi.unpublish(strategy.id); setDetail(undefined); setCards(await ugcApi.mine()); }
    catch (problem) { showError(problem); } finally { setBusy(false); }
  }
  async function remove(strategy: UgcStrategy) {
    if (!confirm(`Удалить стратегию «${strategy.name}»?`)) return;
    setBusy(true); try { await ugcApi.deleteStrategy(strategy.id); setDetail(undefined); setCards(await ugcApi.mine()); window.dispatchEvent(new Event('botarena-strategies-changed')); }
    catch (problem) { showError(problem); } finally { setBusy(false); }
  }
  async function openSend(strategy: UgcStrategy) {
    try { setFriends((await ugcApi.friends()).filter(item => item.status === 'accepted')); setSending(strategy); setDetail(undefined); }
    catch (problem) { showError(problem); }
  }
  async function sendTo(friendId: string) {
    if (!sending) return; setBusy(true);
    try { await ugcApi.sendStrategy(sending.id, friendId); setSending(undefined); setError('Стратегия отправлена другу.'); }
    catch (problem) { showError(problem); } finally { setBusy(false); }
  }
  async function fork() {
    if (!detail) return; setBusy(true);
    try { const result = await ugcApi.fork(detail.id); setDetail(undefined); edit(result); }
    catch (problem) { if (isUnauthorized(problem)) login(); else showError(problem); }
    finally { setBusy(false); }
  }
  async function purchase() {
    if (!detail) return; setBusy(true); setError('');
    try {
      await ugcApi.purchase(detail.id);
      setDetail(undefined); setSection('mine'); setCards(await ugcApi.mine());
      window.dispatchEvent(new Event('botarena-balance-changed'));
      window.dispatchEvent(new Event('botarena-strategies-changed'));
      setError('Стратегия куплена и добавлена в личную мастерскую.');
    } catch (problem) { showError(problem); } finally { setBusy(false); }
  }

  return <section className="ugc-hub">
    <div className="ugc-hero"><div><p className="ugc-kicker">СООБЩЕСТВО BOTARENA</p><h1>Собирай. Испытывай. <span>Делись тактикой.</span></h1><p>Публикуй стратегии, создавай ремиксы и собирай бота из проверенных манёвров.</p></div><div className="ugc-radar" aria-hidden="true"><i /><i /><i /></div></div>
    <div className="ugc-tabs" role="tablist">
      <button className={section === 'catalog' ? 'active' : ''} onClick={() => setSection('catalog')}>Маркетплейс</button>
      <button className={section === 'maneuvers' ? 'active' : ''} onClick={() => setSection('maneuvers')}>Манёвры</button>
      <button className={section === 'mine' ? 'active' : ''} onClick={() => setSection('mine')}>Мои стратегии</button>
      <button className={section === 'friends' ? 'active' : ''} onClick={() => setSection('friends')}>Друзья</button>
      <button className={section === 'rooms' ? 'active' : ''} onClick={() => setSection('rooms')}>Комнаты</button>
      <button className={section === 'maps' ? 'active' : ''} onClick={() => setSection('maps')}>Карты</button>
    </div>
    {error && <p className={error.includes('скопирована') || error.includes('куплена') || error.includes('отправлена') ? 'ugc-notice' : 'error-card'}>{error}</p>}
    {section !== 'maneuvers' && section !== 'friends' && section !== 'rooms' && section !== 'maps' && <>
      <div className="ugc-section-head"><div><h2>{section === 'catalog' ? 'Стратегии сообщества' : 'Личная мастерская'}</h2><p>{section === 'catalog' ? 'Ищи идеи, изучай код и создавай собственные ремиксы.' : 'Все твои стратегии: опубликованные, неопубликованные, активные и требующие исправления.'}</p></div><button className="primary" onClick={newStrategy}>+ Новая стратегия</button></div>
      {section === 'catalog' && <div className="ugc-toolbar"><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, автор или идея…" /><select value={language} onChange={event => setLanguage(event.target.value)}><option value="">Все языки</option><option value="javascript">JavaScript</option><option value="python">Python</option></select><select value={sort} onChange={event => setSort(event.target.value)}><option value="popular">Популярные</option><option value="new">Новые</option><option value="forks">Часто форкают</option></select></div>}
      <div className="ugc-grid">{cards.map(card => <StrategyCard key={card.id} item={card} mine={section === 'mine'} onClick={() => void open(card.id)} />)}{!cards.length && <div className="ugc-empty"><b>{section === 'mine' ? 'Мастерская пуста' : 'Ничего не найдено'}</b><p>{section === 'mine' ? 'Создай первую стратегию — опубликовать её можно будет после проверки кода.' : 'Измени запрос или фильтры.'}</p></div>}</div>
    </>}
    {section === 'maneuvers' && <><div className="ugc-section-head"><div><h2>Библиотека манёвров</h2><p>Копируй готовую механику и адаптируй под своего бота.</p></div></div><div className="ugc-chips"><button className={!category ? 'active' : ''} onClick={() => setCategory('')}>Все</button><button className={category === 'movement' ? 'active' : ''} onClick={() => setCategory('movement')}>Движение</button><button className={category === 'combat' ? 'active' : ''} onClick={() => setCategory('combat')}>Бой</button></div><div className="maneuver-grid">{maneuvers.map(item => <article className="maneuver-card" key={item.id}><span className="maneuver-icon">{item.category === 'combat' ? '⌖' : '↝'}</span><div><small>{item.language === 'python' ? 'Python' : 'JavaScript'} · {item.category === 'combat' ? 'Бой' : 'Движение'}</small><h3>{item.name}</h3><p>{item.description}</p><code>{item.usage}</code><button onClick={async () => { await navigator.clipboard.writeText(item.code); setError('Код манёвра скопирован.'); }}>Копировать код</button></div></article>)}</div></>}
    {section === 'friends' && <FriendsPanel />}
    {section === 'rooms' && <RoomsPanel />}
    {section === 'maps' && <BattleMapEditor />}
    {detail && <div className="ugc-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setDetail(undefined); }}><article className="ugc-modal"><button className="ugc-close" onClick={() => setDetail(undefined)}>×</button><p className="ugc-kicker">@{detail.author.nickname} · {detail.isPublished ? 'опубликована' : 'не опубликована'} · {detail.isActive ? 'активна' : 'неактивна'}</p><h2>{detail.name}</h2><p>{detail.description}</p>{!detail.isActive && <p className="error-card">{detail.validationError ?? 'Код стратегии не проходит проверку выполнения.'}</p>}{detail.salePrice && <p className="strategy-price">◈ {detail.salePrice} кредитов</p>}<div className="ugc-tags">{detail.tags.map(tag => <span key={tag}>{tag}</span>)}</div>{detail.code ? <pre><code>{detail.code}</code></pre> : <div className="paid-code-lock"><b>Исходный код защищён</b><p>Купи стратегию, чтобы получить собственную копию и доступ к коду.</p></div>}<div className="ugc-actions">{detail.isOwner ? <><button onClick={() => edit(detail)}>Редактировать</button><button onClick={() => void openSend(detail)}>Отправить другу</button>{detail.isPublished ? <button onClick={() => void unpublish(detail)}>Снять с публикации</button> : <button className="primary" disabled={!detail.isActive} onClick={() => { setPublishing(detail); setPaid(false); setPublishPrice(10); }}>Опубликовать</button>}<button className="danger-button" onClick={() => void remove(detail)}>Удалить</button></> : <>{detail.salePrice && !detail.canReadCode && <button className="primary" disabled={busy} onClick={() => void purchase()}>Купить за ◈ {detail.salePrice}</button>}<button disabled={busy || !detail.canReadCode} title={!detail.canReadCode ? 'Сначала купите стратегию' : undefined} onClick={() => void fork()}>Создать ремикс</button></>}</div></article></div>}
    {editing && <div className="ugc-modal-backdrop"><form className="ugc-modal ugc-editor" onSubmit={save}><button type="button" className="ugc-close" onClick={() => setEditing(undefined)}>×</button><p className="ugc-kicker">{editing === 'new' ? 'НОВАЯ СТРАТЕГИЯ' : 'РЕДАКТИРОВАНИЕ'}</p><h2>{editing === 'new' ? 'Создать стратегию' : draft.name}</h2><div className="ugc-form-row"><label>Название<input required maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label><label>Язык<select value={draft.language} onChange={event => setDraft({ ...draft, language: event.target.value as StrategyLanguage })}><option value="javascript">JavaScript</option><option value="python">Python</option></select></label></div><label>Описание<textarea rows={2} maxLength={1000} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label><label>Теги<input value={draft.tags.join(', ')} onChange={event => setDraft({ ...draft, tags: event.target.value.split(',') })} placeholder="атака, навигация" /></label><label>Код<textarea className="ugc-code" required value={draft.code} onChange={event => setDraft({ ...draft, code: event.target.value })} spellCheck={false} /></label><div className="ugc-actions"><button type="button" onClick={() => setEditing(undefined)}>Отмена</button><button className="primary" disabled={busy}>{busy ? 'Сохраняем…' : 'Сохранить стратегию'}</button></div></form></div>}
    {publishing && <div className="ugc-modal-backdrop"><section className="ugc-modal"><button className="ugc-close" onClick={() => setPublishing(undefined)}>×</button><p className="ugc-kicker">ПУБЛИКАЦИЯ</p><h2>{publishing.name}</h2><label className="radio-row"><input type="radio" checked={!paid} onChange={() => setPaid(false)} /> Бесплатная стратегия</label><label className="radio-row"><input type="radio" checked={paid} onChange={() => setPaid(true)} /> Платная стратегия</label>{paid && <label>Цена, кредиты<input type="number" min={1} max={1000000} value={publishPrice} onChange={event => setPublishPrice(Number(event.target.value))} /></label>}<div className="ugc-actions"><button onClick={() => setPublishing(undefined)}>Отмена</button><button className="primary" disabled={busy || paid && publishPrice < 1} onClick={() => void publish()}>Опубликовать</button></div></section></div>}
    {sending && <div className="ugc-modal-backdrop"><section className="ugc-modal"><button className="ugc-close" onClick={() => setSending(undefined)}>×</button><p className="ugc-kicker">ОТПРАВИТЬ СТРАТЕГИЮ</p><h2>{sending.name}</h2><p>Друг получит уведомление и сможет принять отдельную копию или отклонить её.</p>{friends.map(friend => <div className="friend-row" key={friend.id}><b>@{friend.user.nickname}</b><span className="friend-spacer" /><button className="primary" disabled={busy} onClick={() => void sendTo(friend.user.id)}>Отправить</button></div>)}{!friends.length && <p className="error-card">Сначала добавьте пользователя в друзья.</p>}</section></div>}
  </section>;
}

function StrategyCard({ item, mine, onClick }: { item: UgcStrategyCard; mine: boolean; onClick: () => void }) {
  return <article className={`ugc-card ${item.isActive ? '' : 'inactive'}`} onClick={onClick} tabIndex={0} onKeyDown={event => { if (event.key === 'Enter') onClick(); }}><div><span className={`ugc-language ${item.language}`}>{item.language === 'python' ? 'Python' : 'JavaScript'}</span>{mine && <><span className={`ugc-visibility ${item.isPublished ? 'public' : 'private'}`}>{item.isPublished ? 'Опубликована' : 'Не опубликована'}</span><span className={`activity ${item.isActive ? 'active' : 'inactive'}`}>{item.isActive ? 'Активна' : 'Неактивна'}</span></>}</div><h3>{item.name}</h3><p>{item.description || 'Автор пока не добавил описание.'}</p>{item.salePrice && <strong className="strategy-price">◈ {item.salePrice}</strong>}<div className="ugc-tags">{item.tags.map(tag => <span key={tag}>{tag}</span>)}</div>{item.forkedFromName && <small className="ugc-origin">↳ ремикс «{item.forkedFromName}»</small>}<footer>{item.author.avatarUrl ? <img src={item.author.avatarUrl} alt="" /> : <span className="ugc-avatar">{item.author.nickname?.[0] ?? '?'}</span>}<b>@{item.author.nickname || 'пилот'}</b><span>▷ {item.runs}　⑂ {item.forks}　♡ {item.likes}</span></footer></article>;
}
