import { useState } from 'react';
import type { BehaviorPresetInfo, LabBot, LabSetup } from './labDraft';
import { botLabel } from './botDisplay';
import { text } from './text';

type BotPatch = Partial<Pick<LabBot, 'name' | 'hp'>>;

export function LabSettingsDialog({ setup, presets, onRosterChange, onReset, onBotChange, onBehaviorChange }: {
  setup: LabSetup;
  presets: BehaviorPresetInfo[];
  onRosterChange: (allies: number, enemies: number) => void;
  onReset: () => void;
  onBotChange: (id: string, patch: BotPatch) => void;
  onBehaviorChange: (id: string, value: string) => void;
}) {
  const [teamHp, setTeamHp] = useState({ player: 100, opponent: 100 });
  const teams = [
    { id: 'player' as const, title: 'Свои танки', count: setup.allyCount },
    { id: 'opponent' as const, title: 'Чужие танки', count: setup.enemyCount },
  ];

  return <div className="lab-settings">
    <div className="lab-settings-top"><p>Настройки сохраняются автоматически.</p><button type="button" onClick={onReset}>{text.lab.reset}</button></div>
    <div className="lab-team-layout">
      {teams.map(team => <section className={`lab-team lab-team-${team.id}`} key={team.id}>
        <header>
          <div><small>{team.id === 'player' ? 'ЛЕВАЯ СТОРОНА' : 'ПРАВАЯ СТОРОНА'}</small><h3>{team.title}</h3></div>
          <label>Количество
            <input type="number" min={1} max={4} value={team.count} onChange={event => {
              const count = Number(event.target.value);
              onRosterChange(team.id === 'player' ? count : setup.allyCount, team.id === 'opponent' ? count : setup.enemyCount);
            }} />
          </label>
        </header>
        <div className="team-hp-control"><label>HP всей команды<input type="number" min={1} max={500} value={teamHp[team.id]} onChange={event => setTeamHp(previous => ({ ...previous, [team.id]: Number(event.target.value) }))} /></label><button type="button" onClick={() => setup.bots.filter(bot => bot.teamId === team.id).forEach(bot => onBotChange(bot.id, { hp: teamHp[team.id] }))}>Применить ко всем</button></div>
        <ul className="lab-team-bots">
          {setup.bots.filter(bot => bot.teamId === team.id).map(bot => <li key={bot.id} className="lab-bot-card">
            <b>{botLabel(bot.id, bot.teamId, setup.bots.map(item => ({ ...item, name: '' })))}</b>
            <label>{text.lab.name}<input type="text" maxLength={24} value={bot.name} placeholder={botLabel(bot.id, bot.teamId, setup.bots.map(item => ({ ...item, name: '' })))} onChange={event => onBotChange(bot.id, { name: event.target.value })} /></label>
            <label>{text.lab.hp}<input type="number" min={1} max={500} value={bot.hp} onChange={event => onBotChange(bot.id, { hp: Number(event.target.value) })} /></label>
            <label>{text.lab.behavior}<select value={bot.source === 'code' ? 'code' : bot.presetId} onChange={event => onBehaviorChange(bot.id, event.target.value)}>
              <option value="code">{text.lab.customCode}</option>
              {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name} ({preset.strength === 'weak' ? text.lab.weak : text.lab.standard})</option>)}
            </select></label>
            {bot.source === 'preset' && <p className="muted">{presets.find(item => item.id === bot.presetId)?.description}</p>}
          </li>)}
        </ul>
      </section>)}
    </div>
  </div>;
}
