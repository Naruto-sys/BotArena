import type { Bot, CampaignSpawn } from './contracts';
import { text } from './text';

const playerColors = ['#3dc9f1', '#7be0ff', '#2aa8d4'];
const opponentColors = ['#ff9a45', '#ffb56e', '#e07a2f'];
const ffaColors = ['#e07a9a', '#9ad07a', '#d0c07a', '#c09ad0', '#7ac0c0'];

export function resolveTeamId(bot: Pick<Bot, 'id' | 'teamId'> | CampaignSpawn): string {
  if (bot.teamId) return bot.teamId;
  if (bot.id === 'player' || bot.id.startsWith('player-')) return 'player';
  if (bot.id === 'opponent' || bot.id.startsWith('opponent-')) return 'opponent';
  return bot.id;
}

export function botColor(bot: Pick<Bot, 'id' | 'teamId'> | CampaignSpawn, roster: Array<Pick<Bot, 'id' | 'teamId'> | CampaignSpawn>): string {
  const team = resolveTeamId(bot);
  const teammates = roster.filter(item => resolveTeamId(item) === team);
  const index = Math.max(0, teammates.findIndex(item => item.id === bot.id));
  if (team === 'player') return playerColors[index % playerColors.length];
  if (team === 'opponent') return opponentColors[index % opponentColors.length];
  const rivals = [...new Set(roster.map(resolveTeamId).filter(id => id !== 'player' && id !== 'opponent'))];
  return ffaColors[Math.max(0, rivals.indexOf(team)) % ffaColors.length];
}

type LabeledBot = Pick<Bot, 'id' | 'teamId'> | CampaignSpawn | { id: string; teamId?: string; name?: string };

export function botLabel(
  botId: string,
  teamId: string | undefined,
  roster: LabeledBot[],
  names?: Record<string, string>,
): string {
  const custom = names?.[botId]?.trim()
    ?? (roster.find(item => item.id === botId) as { name?: string } | undefined)?.name?.trim();
  if (custom) return custom;

  const team = teamId ?? resolveTeamId({ id: botId, teamId });
  const teammates = roster.filter(item => resolveTeamId(item) === team);
  const index = teammates.findIndex(item => item.id === botId);
  const number = index >= 0 ? index + 1 : 1;
  if (team === 'player') {
    return teammates.length > 1 ? text.replay.ally(number) : text.replay.player;
  }
  if (team === 'opponent') {
    return teammates.length > 1 ? text.replay.enemy(number) : text.replay.opponent;
  }
  if (botId === 'player') return text.replay.player;
  const rivalIndex = roster.filter(item => resolveTeamId(item) !== 'player').findIndex(item => item.id === botId);
  return text.replay.rival(rivalIndex >= 0 ? rivalIndex + 1 : number);
}

export function teamWon(result: { winnerBotId: string | null; winnerTeamId?: string | null }): boolean {
  return result.winnerTeamId === 'player' || result.winnerBotId === 'player';
}
