import { useMounted } from './useMounted';
import { useEffect, useState } from 'react';
import type { BattleMap, Wall } from './contracts';
import { isUnauthorized, requireLogin, ugcApi } from './ugcApi';
import { LabArenaEditor } from './LabArenaEditor';
import { classicWalls, layoutBots } from './labDraft';
import { ArenaModal } from './ArenaModal';

const WIDTH = 16, HEIGHT = 10;
const starts = layoutBots(1, 1).map((bot, i) => ({ ...bot, position: { x: i === 0 ? 2 : 14, y: 5 } }));

export function BattleMapEditor({ onPlayMap }: { onPlayMap?: (map: BattleMap) => void }) {
  const mounted = useMounted();
  const [maps, setMaps] = useState<BattleMap[]>([]);
  const [editing, setEditing] = useState<BattleMap | 'new'>();
  const [name, setName] = useState('');
  const [walls, setWalls] = useState<Wall[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [valid, setValid] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);
  async function load() {
    try { const items = await ugcApi.maps(); if (mounted.current) { setMaps(items); setError(''); } }
    catch (problem) { if (!mounted.current) return; if (isUnauthorized(problem)) requireLogin(); else setError(message(problem)); }
  }
  function begin(map?: BattleMap) {
    setEditing(map ?? 'new'); setName(map?.name ?? 'Новая арена');
    setWalls(map?.walls.map(wall => ({ ...wall })) ?? []); setSelected([]); setError(''); setValid(true);
  }
  async function save() {
    const validation = clientValidation(walls);
    if (!valid || validation || !name.trim()) { setError(validation || 'Исправьте недопустимое размещение и укажите название.'); return; }
    setBusy(true); setError('');
    try {
      if (editing === 'new') await ugcApi.createMap({ name, walls });
      else if (editing) await ugcApi.updateMap(editing.id, { name, walls });
      await load(); setEditing(undefined);
    } catch (problem) { if (isUnauthorized(problem)) requireLogin(); else setError(message(problem)); }
    finally { setBusy(false); }
  }
  async function removeMap(map: BattleMap) {
    if (!confirm(`Удалить карту «${map.name}»? Уже созданные комнаты сохранят её снимок.`)) return;
    try { await ugcApi.deleteMap(map.id); await load(); }
    catch (problem) { setError(message(problem)); }
  }

  return <section className="map-library">
    <div className="ugc-section-head"><div><h2>Конструктор арен</h2><p>Создайте карту и откройте её на Арене. Сохранённые карты также доступны при создании PvP-комнаты.</p></div><button className="primary" onClick={() => begin()}>+ Создать карту</button></div>
    {error && !editing && <p role="alert" className="error-card">{error}</p>}
    <div className="map-card-grid">{maps.map(map => <article className="map-card" key={map.id}>
      <MapPreview map={map} /><div><h3>{map.name}</h3><small>{map.walls.length} препятствий</small></div>
      <footer>{onPlayMap && <button className="primary" onClick={() => onPlayMap(map)}>Играть на карте</button>}<button onClick={() => begin(map)}>Редактировать</button><button className="danger-button" onClick={() => void removeMap(map)}>Удалить</button></footer>
    </article>)}{!maps.length && <div className="ugc-empty"><b>Личных карт пока нет</b><p>Создайте арену — она появится здесь и в списке карт для комнаты.</p></div>}</div>
    {editing && <ArenaModal title={editing === 'new' ? 'Новая карта' : 'Редактирование карты'} wide onClose={() => { if (!busy) setEditing(undefined); }}>
      <div className="map-builder"><label>Название<input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label>
        <p className="map-help">Те же инструменты, что на Арене: перетаскивайте стены, тяните углы и меняйте координаты. Места старта фиксированы; пунктиром отмечен безопасный отступ.</p>
        <LabArenaEditor arena={{ width: WIDTH, height: HEIGHT, walls }} bots={starts} selectedWalls={selected}
          onSelectWalls={setSelected} placementError={error} onPlacementError={setError} onValidityChange={setValid}
          validateWalls={clientValidation} botsDraggable={false} spawnSafetyRadius={1} showModeSelector={false}
          mode="destroy" onModeChange={() => {}} onMoveBot={() => {}}
          onChangeWall={(index, wall) => setWalls(previous => previous.map((item, i) => i === index ? wall : item))}
          onAddWall={wall => { setWalls(previous => [...previous, wall]); setSelected([walls.length]); }}
          onRemoveWalls={indices => { setWalls(previous => previous.filter((_, i) => !indices.includes(i))); setSelected([]); }}
          onClassicWalls={() => { setWalls(classicWalls.map(wall => ({ ...wall }))); setSelected([]); }} />
        <div className="ugc-actions"><button disabled={busy} onClick={() => setEditing(undefined)}>Отмена</button><button className="primary" disabled={busy || !valid || !!clientValidation(walls) || !name.trim()} onClick={() => void save()}>{busy ? 'Проверяем карту…' : 'Сохранить карту'}</button></div>
      </div>
    </ArenaModal>}
  </section>;
}

function MapPreview({ map }: { map: BattleMap }) {
  return <svg className="map-preview" viewBox={`0 0 ${map.width} ${map.height}`}><rect width={map.width} height={map.height} /><circle cx="2" cy="5" r=".35" /><circle cx="14" cy="5" r=".35" />{map.walls.map((wall, index) => <rect key={index} {...wall} />)}</svg>;
}

function clientValidation(walls: Wall[]) {
  if (walls.length > 20) return 'На карте может быть не больше 20 препятствий.';
  for (let index = 0; index < walls.length; index++) {
    const wall = walls[index];
    if (![wall.x, wall.y, wall.width, wall.height].every(Number.isFinite)) return 'Координаты препятствия должны быть конечными числами.';
    if (wall.width < .4 || wall.width > 5 || wall.height < .4 || wall.height > 5) return 'Размер препятствия должен быть от 0,4 до 5 клеток.';
    if (wall.x < .2 || wall.y < .2 || wall.x + wall.width > 15.8 || wall.y + wall.height > 9.8) return 'Препятствие выходит за безопасную границу карты.';
    if (hitsSpawn(wall, 2, 5) || hitsSpawn(wall, 14, 5)) return 'Освободите стартовые зоны игроков.';
    if (walls.slice(0, index).some(other => overlaps(wall, other))) return 'Препятствия пересекаются или стоят слишком близко.';
  }
  if (walls.reduce((sum, wall) => sum + wall.width * wall.height, 0) > WIDTH * HEIGHT * .32) return 'Препятствия занимают слишком большую часть карты.';
  return '';
}
function hitsSpawn(wall: Wall, x: number, y: number) { return x >= wall.x - 1 && x <= wall.x + wall.width + 1 && y >= wall.y - 1 && y <= wall.y + wall.height + 1; }
function overlaps(a: Wall, b: Wall) { return a.x < b.x + b.width + .15 && a.x + a.width + .15 > b.x && a.y < b.y + b.height + .15 && a.y + a.height + .15 > b.y; }
function message(problem: unknown) { return problem instanceof Error ? problem.message : 'Не удалось выполнить действие.'; }
