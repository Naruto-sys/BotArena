import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createPortal } from 'react-dom';
import type { AuthSession, OAuthProvider } from './contracts';
import { linkProvider, login, ugcApi } from './ugcApi';

type AuthMode = 'login' | 'register';

export function AuthPanel({ session, onChange }: { session: AuthSession | undefined; onChange: (session: AuthSession) => void }) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [loginValue, setLoginValue] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [providers, setProviders] = useState<OAuthProvider[]>([]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => localStorage.getItem('botarena-theme') === 'light' ? 'light' : 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('botarena-theme', theme);
  }, [theme]);

  useEffect(() => {
    void ugcApi.oauthProviders().then(setProviders).catch(() => setProviders([]));
  }, []);

  useEffect(() => {
    const open = () => { setError(''); setAuthOpen(true); };
    window.addEventListener('botarena-open-auth', open);
    return () => window.removeEventListener('botarena-open-auth', open);
  }, []);

  useEffect(() => {
    if (session?.authenticated && session.needsNickname) setNickname(session.user.nickname ?? '');
  }, [session]);

  async function refresh() {
    const next = await ugcApi.session();
    onChange(next);
    window.dispatchEvent(new Event('botarena-auth-changed'));
  }

  async function submitAuth(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if (authMode === 'login') await ugcApi.passwordLogin(loginValue, password);
      else await ugcApi.register({ login: loginValue, password, nickname, firstName, lastName });
      await refresh(); setAuthOpen(false); setPassword('');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось выполнить вход.'); }
    finally { setSaving(false); }
  }

  async function saveNickname(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { await ugcApi.nickname(nickname); await refresh(); return true; }
    catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось сохранить ник.'); return false; }
    finally { setSaving(false); }
  }

  async function saveProfile(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await ugcApi.profile(firstName, lastName);
      await ugcApi.nickname(nickname);
      await refresh(); setNotice('Профиль сохранён.');
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось сохранить профиль.'); }
    finally { setSaving(false); }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setNotice('');
    try {
      await ugcApi.changePassword(currentPassword, newPassword);
      setCurrentPassword(''); setNewPassword(''); setNotice('Пароль изменён.'); await refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Не удалось изменить пароль.'); }
    finally { setSaving(false); }
  }

  function openSettings() {
    if (!session?.authenticated) return;
    setNickname(session.user.nickname ?? ''); setFirstName(session.user.firstName); setLastName(session.user.lastName);
    setError(''); setNotice(''); setSettingsOpen(true);
  }

  if (!session) return <span className="auth-loading" aria-label="Загрузка профиля" />;
  if (!session.authenticated) return <>
    <button className="account-login" onClick={() => { setError(''); setAuthOpen(true); }}><span className="login-long">Войти / Регистрация</span><span className="login-short">Войти</span></button>
    {authOpen && createPortal(<div className="nickname-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
      <section className="nickname-dialog auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="ugc-close" onClick={() => setAuthOpen(false)}>×</button>
        <p className="ugc-kicker">АККАУНТ BOTARENA</p><h2 id="auth-title">{authMode === 'login' ? 'Войти' : 'Создать аккаунт'}</h2>
        <div className="auth-tabs"><button className={authMode === 'login' ? 'primary' : ''} onClick={() => { setAuthMode('login'); setError(''); }}>Вход</button><button className={authMode === 'register' ? 'primary' : ''} onClick={() => { setAuthMode('register'); setError(''); }}>Регистрация</button></div>
        <form onSubmit={submitAuth}>
          <label>Логин<input autoFocus required minLength={3} maxLength={40} autoComplete="username" value={loginValue} onChange={event => setLoginValue(event.target.value)} /></label>
          <label>Пароль<input required minLength={8} maxLength={128} type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} /></label>
          {authMode === 'register' && <><div className="auth-name-grid"><label>Имя<input maxLength={100} autoComplete="given-name" value={firstName} onChange={event => setFirstName(event.target.value)} /></label><label>Фамилия<input maxLength={100} autoComplete="family-name" value={lastName} onChange={event => setLastName(event.target.value)} /></label></div><label>Уникальный ник<input required minLength={3} maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} /></label></>}
          {error && <p className="error">{error}</p>}
          <button className="primary" disabled={saving}>{saving ? 'Подождите…' : authMode === 'login' ? 'Войти' : 'Зарегистрироваться'}</button>
        </form>
        <div className="auth-divider"><span>или</span></div>
        <div className="oauth-buttons">
          {providers.map(provider => <button key={provider.id} className="oauth-login" style={{ borderColor: provider.color }} onClick={() => login(provider.id)}><b style={{ background: provider.color }}>{provider.badge}</b><span>Продолжить с {provider.displayName}</span></button>)}
          {providers.length === 0 && <p className="muted">OAuth-сервисы не настроены. Используйте локальный логин.</p>}
        </div>
      </section>
    </div>, document.body)}
  </>;

  return <>
    <div className="profile-menu">
      {session.user.avatarUrl ? <img src={session.user.avatarUrl} alt="" referrerPolicy="no-referrer" /> : <span className="profile-fallback">{session.user.firstName[0] || session.user.nickname?.[0] || '?'}</span>}
      <span><b>{session.user.nickname ?? `${session.user.firstName} ${session.user.lastName}`}</b><small>{session.user.firstName} {session.user.lastName}</small></span>
      <strong className="profile-balance" title="Баланс">◈ {session.user.balance ?? 0}</strong>
      <button title={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} aria-label="Переключить тему" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀' : '☾'}</button>
      <button title="Настройки профиля" aria-label="Настройки профиля" onClick={openSettings}>⚙</button>
      <button title="Выйти" aria-label="Выйти" onClick={async () => { await ugcApi.logout(); onChange({ authenticated: false }); }}>↪</button>
    </div>
    {session.needsNickname && createPortal(<div className="nickname-backdrop">
      <form className="nickname-dialog" onSubmit={saveNickname} role="dialog" aria-modal="true" aria-labelledby="nickname-title">
        <p className="ugc-kicker">ДОБРО ПОЖАЛОВАТЬ В BOTARENA</p><h2 id="nickname-title">Как вас называть?</h2>
        <p>Выберите уникальный ник — его увидят другие пилоты.</p>
        <label>Ник<input autoFocus required minLength={3} maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} placeholder="tank_master" /></label>
        {error && <p className="error">{error}</p>}<button className="primary" disabled={saving}>{saving ? 'Проверяем…' : 'Продолжить'}</button>
      </form>
    </div>, document.body)}
    {settingsOpen && !session.needsNickname && createPortal(<div className="nickname-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
      <section className="nickname-dialog profile-settings" role="dialog" aria-modal="true">
        <button type="button" className="ugc-close" onClick={() => setSettingsOpen(false)}>×</button>
        <p className="ugc-kicker">НАСТРОЙКИ ПРОФИЛЯ</p><h2>Профиль и вход</h2>
        <form onSubmit={saveProfile}><div className="auth-name-grid"><label>Имя<input maxLength={100} value={firstName} onChange={event => setFirstName(event.target.value)} /></label><label>Фамилия<input maxLength={100} value={lastName} onChange={event => setLastName(event.target.value)} /></label></div><label>Ник<input required minLength={3} maxLength={24} value={nickname} onChange={event => setNickname(event.target.value)} /></label><button className="primary" disabled={saving}>Сохранить профиль</button></form>
        <form className="password-form" onSubmit={changePassword}><h3>{session.hasPassword ? 'Изменить пароль' : 'Установить пароль'}</h3>{session.hasPassword && <label>Текущий пароль<input required type="password" autoComplete="current-password" value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>}<label>Новый пароль<input required minLength={8} maxLength={128} type="password" autoComplete="new-password" value={newPassword} onChange={event => setNewPassword(event.target.value)} /></label><button disabled={saving}>{session.hasPassword ? 'Изменить пароль' : 'Установить пароль'}</button></form>
        <div className="linked-accounts"><h3>Связанные аккаунты</h3>{providers.map(provider => <div key={provider.id}><span>{provider.displayName}</span>{session.linkedOAuthProviders.includes(provider.id) ? <b>Подключён</b> : <button onClick={() => linkProvider(provider.id)}>Привязать</button>}</div>)}{providers.length === 0 && <p className="muted">OAuth-сервисы не настроены.</p>}</div>
        <div className="theme-setting"><span><b>Тема интерфейса</b><small>{theme === 'dark' ? 'Тёмная' : 'Светлая'}</small></span><button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☀ Светлая' : '☾ Тёмная'}</button></div>
        {error && <p className="error">{error}</p>}{notice && <p className="success-card">{notice}</p>}
      </section>
    </div>, document.body)}
  </>;
}
