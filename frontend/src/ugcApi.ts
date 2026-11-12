import { platformText as ui } from './text';
import type { ArenaUser, AuthSession, BattleChallenge, BattleMap, FriendStrategy, Friendship, FriendUser, GameRoom, ManeuverSnippet, MatchResponse, OAuthProvider, PveAttemptResult, PveCourse, PveLeaderboard, StrategyLanguage, StrategyTransfer, UgcStrategy, UgcStrategyCard, Wall } from './contracts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    const error = new Error(problem?.error ?? problem?.detail ?? `Ошибка сервера (${response.status}).`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return response.status === 204 ? undefined as T : response.json();
}

export const ugcApi = {
  session: () => request<AuthSession>('/api/auth/session'),
  oauthProviders: () => request<OAuthProvider[]>('/api/auth/providers'),
  register: (value: { login: string; password: string; firstName: string; lastName: string; nickname: string }) =>
    request<ArenaUser>('/api/auth/register', { method: 'POST', body: JSON.stringify(value) }),
  passwordLogin: (login: string, password: string) => request<ArenaUser>('/api/auth/password-login', {
    method: 'POST', body: JSON.stringify({ login, password }),
  }),
  nickname: (nickname: string) => request<ArenaUser>('/api/auth/nickname', { method: 'POST', body: JSON.stringify({ nickname }) }),
  profile: (firstName: string, lastName: string) => request<ArenaUser>('/api/auth/profile', {
    method: 'PUT', body: JSON.stringify({ firstName, lastName }),
  }),
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/api/auth/change-password', {
    method: 'POST', body: JSON.stringify({ currentPassword, newPassword }),
  }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  catalog: (query = '', language = '', sort = 'popular') => request<UgcStrategyCard[]>(`/api/ugc/strategies?${new URLSearchParams({ q: query, language, sort })}`),
  mine: () => request<UgcStrategyCard[]>('/api/ugc/me/strategies'),
  strategy: (id: string) => request<UgcStrategy>(`/api/ugc/strategies/${id}`),
  shared: (token: string) => request<UgcStrategy>(`/api/ugc/shared/${encodeURIComponent(token)}`),
  maneuvers: (category = '') => request<ManeuverSnippet[]>(`/api/ugc/maneuvers?category=${encodeURIComponent(category)}`),
  create: (value: SaveStrategy) => request<UgcStrategy>('/api/ugc/strategies', { method: 'POST', body: JSON.stringify(value) }),
  update: (id: string, value: SaveStrategy) => request<UgcStrategy>(`/api/ugc/strategies/${id}`, { method: 'PUT', body: JSON.stringify(value) }),
  publish: (id: string, isPaid: boolean, price: number | null) => request<UgcStrategy>(`/api/ugc/strategies/${id}/publish`, { method: 'POST', body: JSON.stringify({ isPaid, price }) }),
  unpublish: (id: string) => request<void>(`/api/ugc/strategies/${id}/unpublish`, { method: 'POST' }),
  deleteStrategy: (id: string) => request<void>(`/api/ugc/strategies/${id}`, { method: 'DELETE' }),
  fork: (id: string) => request<UgcStrategy>(`/api/ugc/strategies/${id}/fork`, { method: 'POST' }),
  purchase: (id: string) => request<{ strategy: UgcStrategy; balance: number }>(`/api/ugc/strategies/${id}/purchase`, { method: 'POST' }),
  friends: () => request<Friendship[]>('/api/friends/'),
  searchUsers: (query: string) => request<FriendUser[]>(`/api/friends/search?q=${encodeURIComponent(query)}`),
  addFriend: (userId: string) => request<Friendship>(`/api/friends/${userId}`, { method: 'POST' }),
  acceptFriend: (friendshipId: string) => request<Friendship>(`/api/friends/${friendshipId}/accept`, { method: 'POST' }),
  removeFriend: (friendshipId: string) => request<void>(`/api/friends/${friendshipId}`, { method: 'DELETE' }),
  friendStrategies: (friendId: string) => request<FriendStrategy[]>(`/api/friends/${friendId}/strategies`),
  friendMatch: (friendId: string, playerStrategyId: string, opponentStrategyId: string) =>
    request<MatchResponse>(`/api/friends/${friendId}/matches`, {
      method: 'POST', body: JSON.stringify({ playerStrategyId, opponentStrategyId }),
    }),
  challenges: () => request<BattleChallenge[]>('/api/friends/challenges'),
  challengeFriend: (friendId: string, strategyId: string, stake: number) => request<BattleChallenge>(`/api/friends/${friendId}/challenges`, {
    method: 'POST', body: JSON.stringify({ strategyId, stake }),
  }),
  acceptChallenge: (challengeId: string, strategyId: string) => request<{ match: MatchResponse; winnerId: string | null }>(`/api/friends/challenges/${challengeId}/accept`, {
    method: 'POST', body: JSON.stringify({ strategyId }),
  }),
  declineChallenge: (challengeId: string) => request<void>(`/api/friends/challenges/${challengeId}/decline`, { method: 'POST' }),
  sendStrategy: (strategyId: string, friendId: string) => request<StrategyTransfer>(`/api/ugc/strategies/${strategyId}/send/${friendId}`, { method: 'POST' }),
  transfers: () => request<StrategyTransfer[]>('/api/ugc/transfers'),
  acceptTransfer: (id: string) => request<{ strategyId: string }>(`/api/ugc/transfers/${id}/accept`, { method: 'POST' }),
  declineTransfer: (id: string) => request<void>(`/api/ugc/transfers/${id}/decline`, { method: 'POST' }),
  rooms: (filters: { clipboard?: string; presets?: string; maxCharactersPerSecond?: string; maxStake?: string } = {}) =>
    request<GameRoom[]>(`/api/rooms/?${new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== '') as [string, string][])}`),
  createRoom: (value: CreateRoom) => request<GameRoom>('/api/rooms/', { method: 'POST', body: JSON.stringify(value) }),
  room: (id: string) => request<{ room: GameRoom; match: MatchResponse | null; winnerId: string | null; draft?: { code: string; language: StrategyLanguage; sourceStrategyId: string | null; isReady: boolean } }>(`/api/rooms/${id}`),
  joinRoom: (id: string, password?: string) => request<GameRoom>(`/api/rooms/${id}/join`, { method: 'POST', body: JSON.stringify({ password }) }),
  myRooms: () => request<GameRoom[]>('/api/rooms/mine'),
  updateRoomDraft: (id: string, value: { code: string; language: StrategyLanguage; strategyId?: string }) =>
    request(`/api/rooms/${id}/draft`, { method: 'PUT', body: JSON.stringify(value) }),
  readyRoom: (id: string) => request<{ waiting: boolean; match?: MatchResponse; winnerId?: string | null }>(`/api/rooms/${id}/ready`, { method: 'POST' }),
  cancelRoom: (id: string) => request<void>(`/api/rooms/${id}`, { method: 'DELETE' }),
  maps: () => request<BattleMap[]>('/api/maps/'),
  createMap: (value: { name: string; walls: Wall[] }) => request<BattleMap>('/api/maps/', { method: 'POST', body: JSON.stringify(value) }),
  updateMap: (id: string, value: { name: string; walls: Wall[] }) => request<BattleMap>(`/api/maps/${id}`, { method: 'PUT', body: JSON.stringify(value) }),
  deleteMap: (id: string) => request<void>(`/api/maps/${id}`, { method: 'DELETE' }),
  pve: () => request<PveCourse>('/api/pve/'),
  pveLeaderboard: (id: string) => request<PveLeaderboard>(`/api/pve/levels/${id}/leaderboard`),
  attemptPve: (id: string, code: string, language: StrategyLanguage) => request<PveAttemptResult>(`/api/pve/levels/${id}/attempt`, {
    method: 'POST', body: JSON.stringify({ code, language }),
  }),
};

export interface SaveStrategy { name: string; description: string; language: StrategyLanguage; code: string; tags: string[]; salePrice: number | null }
export interface CreateRoom { name: string; allowClipboard: boolean; allowPresetStrategies: boolean; maxCharactersPerSecond: number; stake: number; mapId: string | null; isPrivate: boolean; password: string }

export interface AuthNotice { message: string; canLogin: boolean }

function announceAuth(notice: AuthNotice) {
  window.dispatchEvent(new CustomEvent<AuthNotice>('botarena-auth-notice', { detail: notice }));
}

// A protected section must never navigate away merely because its API returned 401.
export function requireLogin() {
  announceAuth({ message: ui.authRequiredNotice, canLogin: true });
}

export function login(provider: string) {
  location.assign(`/api/auth/oauth/${encodeURIComponent(provider)}/login?returnUrl=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

export function linkProvider(provider: string) {
  location.assign(`/api/auth/oauth/${encodeURIComponent(provider)}/link?returnUrl=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
}

export function isUnauthorized(error: unknown) {
  return error instanceof Error && (error as Error & { status?: number }).status === 401;
}
