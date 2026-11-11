import { useEffect, useRef, useState } from 'react';
import type { CampaignTrack, StrategyLanguage } from './contracts';
import type { SavedStrategy } from './strategyLibrary';
import { platformText as ui } from './text';
export type Page = keyof typeof ui.nav;
export function ComingSoon({ children }: { children: React.ReactNode }) {
  return <div className="ux-placeholder"><span className="ux-tag">{ui.soon}</span><p>{children}</p></div>;
}
export function Home({ tracks, completed, languages, navigate, onContinue }: { tracks: CampaignTrack[]; completed: string[]; languages: StrategyLanguage[]; navigate: (page: Page) => void; onContinue: () => void }) {
  const available = tracks.filter(t => t.available);
  const ids = new Set(tracks.flatMap(t => t.levels.map(l => l.id)));
  const done = completed.filter(id => ids.has(id)).length;
  return <div className="ux-home">
    <section className="ux-hero"><div><small>BOTARENA / ACADEMY</small><h1>{ui.hero}</h1><p>{ui.intro}</p><div className="ux-actions"><button className="primary" onClick={onContinue}>{ui.learn} →</button><button onClick={() => navigate('arena')}>{ui.arena}</button></div></div><div className="ux-radar" aria-hidden="true">BA</div></section>
    <div className="ux-stats"><div><b>{done} / {ids.size}</b><span>{ui.progress}</span></div><div><b>{available.length}</b><span>{ui.chapters}</span></div><div><b>{languages.map(l => l === 'javascript' ? 'JS' : 'Python').join(' + ')}</b><span>{ui.local}</span></div></div>
    <h2>{ui.next}</h2><div className="ux-grid">{ui.paths.map(([title, description], i) => <article className="panel ux-path" key={title}><small>0{i + 1}</small><h2>{title}</h2><p>{description}</p><button onClick={() => navigate((['learn', 'arena', 'workshop'] as Page[])[i])}>{title} →</button></article>)}</div>
  </div>;
}
export function Workshop({ items, onOpen, onRemove, onArena }: { items: SavedStrategy[]; onOpen: (item: SavedStrategy) => void; onRemove: (id: string) => void; onArena: () => void }) {
  const [tab, setTab] = useState<keyof typeof ui.tabs>('mine');
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');
  const filtered = items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) && (language === 'all' || item.language === language));
  return <><h1>{ui.nav.workshop}</h1><p className="ux-lead">{ui.paths[2][1]}</p><div className="ux-tabs">{Object.entries(ui.tabs).map(([id, label]) => <button key={id} aria-pressed={tab === id} onClick={() => setTab(id as typeof tab)}>{label}</button>)}</div>
    {tab === 'mine' ? <><div className="ux-actions"><input aria-label={ui.search} placeholder={ui.search} value={query} onChange={e => setQuery(e.target.value)} /><select aria-label={ui.all} value={language} onChange={e => setLanguage(e.target.value)}><option value="all">{ui.all}</option><option value="javascript">JavaScript</option><option value="python">Python</option></select><button className="primary" onClick={onArena}>{ui.copy} →</button></div><div className="ux-grid">{filtered.map(item => <article className="panel ux-path" key={item.id}><small>{item.language.toUpperCase()} · {item.movement}</small><h2>{item.name}</h2><p>{ui.saved}</p><div className="ux-actions"><button className="primary" onClick={() => onOpen(item)}>{ui.edit}</button><button onClick={() => onRemove(item.id)}>{ui.remove}</button></div></article>)}</div>{filtered.length === 0 && <div className="ux-placeholder">{ui.empty}</div>}</>
    : tab === 'maps' ? <article className="panel ux-path"><h2>{ui.map}</h2><p>{ui.mapNote}</p><button onClick={onArena}>{ui.openMap} →</button></article>
    : <ComingSoon>{tab === 'catalog' ? ui.catalogNote : ui.movesNote}</ComingSoon>}
  </>;
}
export function Community() {
  const [tab, setTab] = useState<string>(ui.communityTabs[0]);
  return <><h1>{ui.nav.community}</h1><div className="ux-tabs">{ui.communityTabs.map(label => <button key={label} aria-pressed={tab === label} onClick={() => setTab(label)}>{label}</button>)}</div><ComingSoon>{ui.communityNote}</ComingSoon></>;
}

export function LearningMap({ tracks, completed, onOpen }: {
  tracks: CampaignTrack[]; completed: string[]; onOpen: (track: CampaignTrack, levelId: string) => void;
}) {
  return <div className="learning-map">{tracks.map(track => <details key={track.id} className="panel chapter-route" open={track.available || undefined}>
    <summary><span className="ux-tag">{track.available ? `${completed.filter(id => track.levels.some(l => l.id === id)).length} / ${track.levelCount}` : ui.soon}</span><strong>{track.name}</strong><p>{track.summary}</p></summary>
    <div className="lesson-road">{track.levels.map(level => {
      const done = completed.includes(level.id);
      const unlocked = track.available && (level.order <= 1 || track.levels.some(prev => prev.order === level.order - 1 && completed.includes(prev.id)));
      return <div key={level.id} className={`lesson-stop ${done ? 'passed' : unlocked ? 'available' : 'locked'}`}>
        <button disabled={!unlocked} onClick={() => onOpen(track, level.id)} aria-label={`${level.name}: ${done ? ui.levelState.done : unlocked ? ui.levelState.available : ui.levelState.locked}`}>{done ? '✓' : unlocked ? level.order : '⌁'}</button>
        <div><small>{done ? ui.levelState.done : unlocked ? ui.levelState.available : ui.levelState.locked}</small><h2>{level.name}</h2><p>{level.summary}</p></div>
      </div>;
    })}</div>
  </details>)}</div>;
}

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="panel ux-modal" aria-labelledby="settings-title" onCancel={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <h2 id="settings-title">{ui.settings}</h2><p>{ui.settingsNote}</p><button autoFocus onClick={onClose}>{ui.close}</button>
  </dialog>;
}

const tourStages: { page: Page; title: string; tips: string[] }[] = [
  { page: 'home', title: 'Главная', tips: ['Продолжайте с ближайшего доступного испытания.', 'Карточка прогресса показывает пройденные уровни.', 'Быстрые переходы ведут в обучение, арену и мастерскую.'] },
  { page: 'learn', title: 'Обучение', tips: ['Уровни открываются по порядку.', 'В редакторе задаются команды робота.', 'Запустите испытание и изучите запись боя.'] },
  { page: 'arena', title: 'Арена', tips: ['Здесь можно менять код и состав участников.', 'Карту и препятствия можно редактировать перед боем.', 'PvP-комнаты доступны зарегистрированным игрокам.'] },
  { page: 'workshop', title: 'Мастерская', tips: ['Локальные стратегии остаются на этом устройстве.', 'Опубликованные стратегии доступны после входа.', 'Платный код открывается после покупки.'] },
  { page: 'community', title: 'Сообщество', tips: ['Добавляйте игроков в друзья.', 'Отправляйте друзьям копии стратегий.', 'Приглашайте друзей в PvP-бои со ставкой.'] },
];

export function SystemTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: Page) => void }) {
  const [stage, setStage] = useState(0);
  const current = tourStages[stage];
  useEffect(() => { onNavigate(current.page); }, [current.page, onNavigate]);
  function finish() { localStorage.setItem('botarena-system-tour', 'completed'); onClose(); }
  return <div className="tour-backdrop" role="presentation"><section className="tour-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-title">
    <button className="tour-close" onClick={onClose} aria-label="Закрыть">×</button>
    <small>ЭТАП {stage + 1} ИЗ {tourStages.length}</small><h2 id="tour-title">{current.title}</h2>
    <div className="tour-progress">{tourStages.map((_, index) => <span key={index} className={index <= stage ? 'done' : ''} />)}</div>
    <ol>{current.tips.map(tip => <li key={tip}>{tip}</li>)}</ol>
    <div className="tour-actions"><button disabled={stage === 0} onClick={() => setStage(value => value - 1)}>← Назад</button>{stage === tourStages.length - 1 ? <button className="primary" onClick={finish}>Завершить</button> : <button className="primary" onClick={() => setStage(value => value + 1)}>Далее →</button>}</div>
  </section></div>;
}

export function FirstRunDialog({ onStart, onClose }: { onStart: () => void; onClose: () => void }) {
  return <div className="tour-backdrop"><section className="tour-dialog first-run-dialog" role="dialog" aria-modal="true" aria-labelledby="first-run-title">
    <small>ПЕРВЫЙ ЗАПУСК · 1 МИНУТА</small><h2 id="first-run-title">Посмотрите, как оживает код</h2>
    <p>Мы уже подготовили простую стратегию: робот найдёт противника, наведёт башню и выстрелит. Откроем Арену — останется нажать «Запустить».</p>
    <pre><code>{'function tick({ self, enemy }) {\n  if (!enemy) return { leftTrack: 0.4, rightTrack: -0.4 };\n  const x = enemy.position.x - self.position.x;\n  const y = enemy.position.y - self.position.y;\n  return { aimDirection: { x, y }, shoot: self.canShoot };\n}'}</code></pre>
    <p className="guest-progress-note">Играть можно без аккаунта. Гостевой прогресс не сохраняется — войдите или зарегистрируйтесь, чтобы продолжить с того же места позже.</p>
    <div className="tour-actions"><button onClick={onClose}>Не сейчас</button><button className="primary" onClick={onStart}>Вставить пример и открыть Арену →</button></div>
  </section></div>;
}
