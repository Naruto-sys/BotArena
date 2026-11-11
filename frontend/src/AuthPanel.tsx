import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AuthSession } from './contracts';
import { login, ugcApi } from './ugcApi';

export function AuthPanel({ session, onChange }: { session: AuthSession | undefined; onChange: (session: AuthSession) => void }) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('botarena-theme') === 'light' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('botarena-theme', theme);
  }, [theme]);

  async function saveNickname(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const user = await ugcApi.nickname(nickname);
      if (session?.authenticated) onChange({ ...session, user, needsNickname: false });
      window.dispatchEvent(new Event('botarena-auth-changed'));
      return true;
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось сохранить ник.'); return false; }
    finally { setSaving(false); }
  }

  if (!session) return <span className="auth-loading" aria-label="Загрузка профиля" />;
  if (!session.authenticated) return <button className="yandex-login" onClick={login}><b>Я</b> Войти через Яндекс</button>;
  return <>
    <div className="profile-menu">
      {session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="profile-fallback">{session.user.firstName[0] || '?'}</span>}
      <span><b>{session.user.nickname ?? `${session.user.firstName} ${session.user.lastName}`}</b><small>{session.user.firstName} {session.user.lastName}</small></span>
      <strong className="profile-balance" title="Баланс">◈ {session.user.balance ?? 0}</strong>
      <button title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-label="Переключить тему" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button>
      <button title="Настройки профиля" aria-label="Настройки профиля" onClick={() => { setNickname(session.user.nickname ?? ''); setError(''); setSettingsOpen(true); }}>⚙</button>
      <button title="Выйти" aria-label="Выйти" onClick={async () => { await ugcApi.logout(); onChange({ authenticated: false }); }}>↪</button>
    </div>
    {session.needsNickname && createPortal(<div className="nickname-backdrop" role="presentation">
      <form className="nickname-dialog" onSubmit={saveNickname} role="dialog" aria-modal="true" aria-labelledby="nickname-title">
        {session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : null}
        <p className="ugc-kicker">ДОБРО ПОЖАЛОВАТЬ В BOTARENA</p><h2 id="nickname-title">Как вас называть?</h2>
        <p>Имя и фото получены из Yandex ID. Теперь выберите уникальный ник — его увидят другие пилоты.</p>
        <label>Ник<input autoFocus required minLength={3} maxLength={24} pattern="[A-Za-zА-Яа-яЁё0-9_-]{3,24}" value={nickname} onChange={event => setNickname(event.target.value)} placeholder="tank_master" /></label>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={saving}>{saving ? 'Проверяем…' : 'Продолжить'}</button>
      </form>
    </div>, document.body)}
    {settingsOpen && !session.needsNickname && createPortal(<div className="nickname-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <form className="nickname-dialog" onSubmit={async event => { if (await saveNickname(event)) setSettingsOpen(false); }} role="dialog" aria-modal="true">
        <button type="button" className="ugc-close" onClick={() => setSettingsOpen(false)}>×</button>
        <p className="ugc-kicker">НАСТРОЙКИ ПРОФИЛЯ</p><h2>Изменить ник</h2>
        <label>Ник<input autoFocus required minLength={3} maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} /></label>
        <div className="theme-setting"><span><b>Тема интерфейса</b><small>{theme === 'dark' ? 'Тёмная' : 'Светлая'}</small></span><button type="button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Светлая' : '☾ Тёмная'}</button></div>
        {error && <p className="error">{error}</p>}
        <button className="primary" disabled={saving}>{saving ? 'Проверяем…' : 'Сохранить'}</button>
      </form>
    </div>, document.body)}
  </>;
}
