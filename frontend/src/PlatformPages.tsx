import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CampaignTrack } from './contracts';
import type { SavedStrategy } from './strategyLibrary';
import { platformText as ui } from './text';
export type Page = keyof typeof ui.nav;
export function ComingSoon({ children }: { children: React.ReactNode }) {
  return <div className="ux-placeholder"><span className="ux-tag">{ui.soon}</span><p>{children}</p></div>;
}
export function Home({ navigate, onContinue, onDemo, demoInvite }: { navigate: (page: Page) => void; onContinue: () => void; onDemo: () => void; demoInvite: boolean }) {
  return <div className="ux-home">
    <section className="ux-hero" data-tour-target="home-start"><div><h1>{ui.hero}</h1><p>{ui.intro}</p><div className="ux-actions"><button className="primary" onClick={onContinue}>{ui.learn} →</button><button onClick={() => navigate('arena')}>{ui.arena}</button><button className={`demo-launch-button ${demoInvite ? 'soft-invite-pulse' : ''}`} onClick={onDemo}>▶ Тестовый запуск · 1 минута</button></div>{demoInvite && <p className="demo-invite-copy">Начните с готового примера: код уже написан, останется запустить бой.</p>}</div><div className="ux-radar" aria-hidden="true">BA</div></section>
    <h2>{ui.next}</h2><div className="ux-grid">{ui.paths.map(([title, description], i) => <article className="panel ux-path" key={title}><small>0{i + 1}</small><h2>{title}</h2><p>{description}</p><button onClick={() => navigate((['learn', 'arena', 'workshop'] as Page[])[i])}>{title} →</button></article>)}</div>
  </div>;
}
export function Workshop({ items, onOpen, onRemove, onArena, onCommunity }: {
  items: SavedStrategy[]; onOpen: (item: SavedStrategy) => void; onRemove: (id: string) => void;
  onArena: () => void; onCommunity: () => void;
}) {
  const [query, setQuery] = useState('');
  const [language, setLanguage] = useState('all');
  const filtered = items.filter(item => item.name.toLowerCase().includes(query.toLowerCase()) && (language === 'all' || item.language === language));
  return <>
    <div className="workshop-heading" data-tour-target="workshop-heading"><div><h1>{ui.nav.workshop}</h1><p className="ux-lead">{ui.paths[2][1]}</p></div><button onClick={onCommunity}>{ui.onlineWorkshop} ↗</button></div>
    <div className="ux-actions workshop-tools"><input aria-label={ui.search} placeholder={ui.search} value={query} onChange={e => setQuery(e.target.value)} /><select aria-label={ui.all} value={language} onChange={e => setLanguage(e.target.value)}><option value="all">{ui.all}</option><option value="javascript">JavaScript</option><option value="python">Python</option></select><button className="primary" onClick={onArena}>{ui.copy} →</button></div>
    <div data-tour-target="workshop-strategies"><div className="ux-grid">{filtered.map(item => <article className="panel ux-path" key={item.id}><small>{item.language.toUpperCase()} · {item.movement}</small><h2>{item.name}</h2><p>{ui.saved}</p><div className="ux-actions"><button className="primary" onClick={() => onOpen(item)}>{ui.edit}</button><button onClick={() => onRemove(item.id)}>{ui.remove}</button></div></article>)}</div>{filtered.length === 0 && <div className="ux-placeholder">{items.length ? ui.noMatches : ui.empty}</div>}</div>
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

const tourSteps: { page: Page; section: string; title: string; description: string; target: string }[] = [
  { page: 'home', section: 'Главная', title: 'Первый шаг', description: 'Начните с тестового боя или ближайшего учебного испытания.', target: '[data-tour-target="home-start"]' },
  { page: 'home', section: 'Главная', title: 'Тестовый бой', description: 'Готовый пример поможет посмотреть, как код управляет роботом: запустите его на Арене.', target: '.demo-launch-button' },
  { page: 'home', section: 'Главная', title: 'Маршруты', description: 'Карточки ведут к обучению, свободной арене и сохранённым стратегиям.', target: '.ux-grid' },
  { page: 'learn', section: 'Обучение', title: 'Карта уровней', description: 'Доступные узлы подсвечены, а следующий уровень открывается после победы.', target: '.learning-map' },
  { page: 'learn', section: 'Обучение', title: 'Доступное испытание', description: 'Нажмите на яркий узел, чтобы открыть редактор и условие задачи.', target: '.lesson-stop.available' },
  { page: 'learn', section: 'Обучение', title: 'Режим обучения', description: 'Переключайтесь между учебными испытаниями и рейтинговым PvE.', target: '.ux-tabs' },
  { page: 'arena', section: 'Арена', title: 'Редактор стратегии', description: 'Здесь меняются код, язык, шасси и состав участников боя.', target: '.editor' },
  { page: 'arena', section: 'Арена', title: 'Поле боя', description: 'После запуска здесь появится запись матча и инструменты анализа.', target: '.replay' },
  { page: 'arena', section: 'Арена', title: 'PvP-комнаты', description: 'Зарегистрированные игроки могут перейти к открытым сетевым комнатам.', target: '.platform-page-body > .ux-tabs' },
  { page: 'workshop', section: 'Мастерская', title: 'Мастерская', description: 'Здесь хранятся стратегии на этом устройстве. Публикации, манёвры и карты находятся в сообществе.', target: '[data-tour-target="workshop-heading"]' },
  { page: 'workshop', section: 'Мастерская', title: 'Поиск и создание', description: 'Фильтруйте стратегии или создавайте новую копию для эксперимента.', target: '.ux-actions' },
  { page: 'workshop', section: 'Мастерская', title: 'Ваши стратегии', description: 'Сохранённые работы появляются здесь. Если список пуст, создайте первую стратегию на Арене.', target: '[data-tour-target="workshop-strategies"]' },
  { page: 'community', section: 'Сообщество', title: 'Стратегии сообщества', description: 'Изучайте публикации, покупайте код и создавайте собственные ремиксы.', target: '.ugc-hero' },
  { page: 'community', section: 'Сообщество', title: 'Навигация сообщества', description: 'Здесь находятся маркетплейс, друзья, комнаты и ваши публикации.', target: '.ugc-tabs' },
  { page: 'community', section: 'Сообщество', title: 'Общение и PvP', description: 'Добавляйте друзей, делитесь стратегиями и приглашайте их в бой.', target: '.ugc-hub' },
];

export function SystemTour({ onClose, onNavigate }: { onClose: () => void; onNavigate: (page: Page) => void }) {
  const [step, setStep] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const current = tourSteps[step];
  const section = [...new Set(tourSteps.map(item => item.section))].indexOf(current.section);
  useEffect(() => {
    onNavigate(current.page);
    let highlighted: Element | null = null;
    let attempts = 0;
    const timer = window.setInterval(() => {
      highlighted = [...document.querySelectorAll(current.target)].find(node => {
        const bounds = node.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0;
      }) ?? null;
      if (highlighted || attempts++ > 12) {
        window.clearInterval(timer);
        highlighted?.classList.add('tour-highlight-pulse');
        highlighted?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
    return () => { window.clearInterval(timer); highlighted?.classList.remove('tour-highlight-pulse'); };
  }, [step]);
  function finish() {
    localStorage.setItem('botarena-system-tour', 'completed'); setFinishing(true);
    window.setTimeout(onClose, 1300);
  }
  if (finishing) return createPortal(<div className="tour-backdrop"><div className="tour-complete"><span>✓</span><h2>Обзор пройден!</h2><p>Можно переходить к первому бою.</p></div></div>, document.body);
  return createPortal(<div className="tour-backdrop" role="presentation"><section className="tour-dialog" role="dialog" aria-labelledby="tour-title">
    <button className="tour-close" onClick={onClose} aria-label="Закрыть">×</button>
    <small>РАЗДЕЛ {section + 1} ИЗ 5 · ШАГ {step + 1} ИЗ {tourSteps.length}</small><h2 id="tour-title">{current.title}</h2>
    <div className="tour-progress">{[0, 1, 2, 3, 4].map(index => <span key={index} className={index <= section ? 'done' : ''} />)}</div>
    <p>{current.description}</p>
    <div className="tour-actions"><button disabled={step === 0} onClick={() => setStep(value => value - 1)}>← Назад</button>{step === tourSteps.length - 1 ? <button className="primary" onClick={finish}>Завершить</button> : <button className="primary" onClick={() => setStep(value => value + 1)}>Далее →</button>}</div>
  </section></div>, document.body);
}
