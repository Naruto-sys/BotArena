import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { BattleMap, Wall } from './contracts';
import { isUnauthorized, login, ugcApi } from './ugcApi';

const WIDTH = 16;
const HEIGHT = 10;
const snap = (value: number) => Math.round(value * 4) / 4;

export function BattleMapEditor() {
  const [maps, setMaps] = useState<BattleMap[]>([]);
  const [editing, setEditing] = useState<BattleMap | 'new'>();
  const [name, setName] = useState('');
  const [walls, setWalls] = useState<Wall[]>([]);
  const [selected, setSelected] = useState<number>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { void load(); }, []);
  async function load() {
    try { setMaps(await ugcApi.maps()); setError(''); }
    catch (problem) { if (isUnauthorized(problem)) login(); else setError(message(problem)); }
  }
  function begin(map?: BattleMap) {
    setEditing(map ?? 'new'); setName(map?.name ?? 'Новая арена'); setWalls(map?.walls.map(wall => ({ ...wall })) ?? []);
    setSelected(undefined); setError('');
  }
  function add(event: MouseEvent<SVGSVGElement>) {
    if (walls.length >= 20) { setError('На карте может быть не больше 20 препятствий.'); return; }
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(.25, Math.min(13.75, snap((event.clientX - bounds.left) / bounds.width * WIDTH - 1)));
    const y = Math.max(.25, Math.min(8.75, snap((event.clientY - bounds.top) / bounds.height * HEIGHT - .5)));
    const next = [...walls, { x, y, width: 2, height: 1 }];
    setWalls(next); setSelected(next.length - 1); setError(clientValidation(next));
  }
  function update(field: keyof Wall, raw: number) {
    if (selected == null || !Number.isFinite(raw)) return;
    const next = walls.map((wall, index) => index === selected ? { ...wall, [field]: snap(raw) } : wall);
    setWalls(next); setError(clientValidation(next));
  }
  function remove() {
    if (selected == null) return;
    const next = walls.filter((_, index) => index !== selected); setWalls(next); setSelected(undefined); setError(clientValidation(next));
  }
  async function save() {
    const validation = clientValidation(walls);
    if (!name.trim()) { setError('Введите название карты.'); return; }
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try {
      if (editing === 'new') await ugcApi.createMap({ name, walls });
      else if (editing) await ugcApi.updateMap(editing.id, { name, walls });
      await load(); setEditing(undefined);
    } catch (problem) { setError(message(problem)); }
    finally { setBusy(false); }
  }
  async function removeMap(map: BattleMap) {
    if (!confirm(`Удалить карту «${map.name}»? Уже созданные комнаты сохранят её снимок.`)) return;
    try { await ugcApi.deleteMap(map.id); await load(); }
    catch (problem) { setError(message(problem)); }
  }

  return <section className="map-library">
    <div className="ugc-section-head"><div><h2>Конструктор арен</h2><p>Расставляй препятствия и используй карту в комнате с другом.</p></div><button className="primary" onClick={() => begin()}>+ Создать карту</button></div>
    {error && !editing && <p className="error-card">{error}</p>}
    <div className="map-card-grid">{maps.map(map => <article className="map-card" key={map.id}><MapPreview map={map} /><div><h3>{map.name}</h3><small>{map.walls.length} препятствий</small></div><footer><button onClick={() => begin(map)}>Редактировать</button><button className="danger-button" onClick={() => void removeMap(map)}>Удалить</button></footer></article>)}{!maps.length && <div className="ugc-empty"><b>Личных карт пока нет</b><p>Создай арену и выбери её при создании игровой комнаты.</p></div>}</div>
    {editing && <div className="ugc-modal-backdrop"><section className="ugc-modal map-builder"><button className="ugc-close" onClick={() => setEditing(undefined)}>×</button><p className="ugc-kicker">КОНСТРУКТОР УРОВНЯ</p><h2>{editing === 'new' ? 'Новая карта' : 'Редактирование карты'}</h2><label>Название<input maxLength={80} value={name} onChange={event => setName(event.target.value)} /></label><p className="map-help">Нажми на свободное место, чтобы добавить препятствие. Стартовые зоны отмечены кругами.</p><div className="map-workspace"><svg className="map-canvas" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} onClick={add}><defs><pattern id="builder-grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M1 0H0V1" fill="none" stroke="currentColor" strokeWidth=".035" /></pattern></defs><rect width={WIDTH} height={HEIGHT} className="map-floor" /><rect width={WIDTH} height={HEIGHT} fill="url(#builder-grid)" /><circle cx="2" cy="5" r="1" className="spawn-safe player" /><circle cx="14" cy="5" r="1" className="spawn-safe opponent" /><text x="2" y="5.15">A</text><text x="14" y="5.15">B</text>{walls.map((wall, index) => <rect key={index} {...wall} rx=".08" className={index === selected ? 'selected' : ''} onClick={event => { event.stopPropagation(); setSelected(index); }} />)}</svg>{selected != null && walls[selected] && <div className="wall-inspector"><b>Препятствие {selected + 1}</b>{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{field === 'width' ? 'Ширина' : field === 'height' ? 'Высота' : field.toUpperCase()}<input type="number" step="0.25" value={walls[selected][field]} onChange={event => update(field, Number(event.target.value))} /></label>)}<button className="danger-button" onClick={remove}>Удалить препятствие</button></div>}</div><div className="map-safety"><span>✓ Максимум 20 препятствий</span><span>✓ Стартовые зоны свободны</span><span>✓ Сервер проверит проходимость</span></div>{error && <p className="error-card">{error}</p>}<div className="ugc-actions"><button onClick={() => setEditing(undefined)}>Отмена</button><button className="primary" disabled={busy || !!clientValidation(walls) || !name.trim()} onClick={() => void save()}>{busy ? 'Проверяем карту…' : 'Сохранить карту'}</button></div></section></div>}
  </section>;
}

function MapPreview({ map }: { map: BattleMap }) {
  return <svg className="map-preview" viewBox={`0 0 ${map.width} ${map.height}`}><rect width={map.width} height={map.height} /><circle cx="2" cy="5" r=".35" /><circle cx="14" cy="5" r=".35" />{map.walls.map((wall, index) => <rect key={index} {...wall} />)}</svg>;
}

function clientValidation(walls: Wall[]) {
  if (walls.length > 20) return 'На карте может быть не больше 20 препятствий.';
  for (let index = 0; index < walls.length; index++) {
    const wall = walls[index];
    if (wall.width < .4 || wall.width > 5 || wall.height < .4 || wall.height > 5) return 'Размер препятствия должен быть от 0,4 до 5 клеток.';
    if (wall.x < .2 || wall.y < .2 || wall.x + wall.width > 15.8 || wall.y + wall.height > 9.8) return 'Препятствие выходит за безопасную границу карты.';
    if (hitsSpawn(wall, 2, 5) || hitsSpawn(wall, 14, 5)) return 'Освободи стартовые зоны игроков.';
    if (walls.slice(0, index).some(other => overlaps(wall, other))) return 'Препятствия пересекаются или стоят слишком близко.';
  }
  if (walls.reduce((sum, wall) => sum + wall.width * wall.height, 0) > WIDTH * HEIGHT * .32) return 'Препятствия занимают слишком большую часть карты.';
  return '';
}
function hitsSpawn(wall: Wall, x: number, y: number) { return x >= wall.x - 1 && x <= wall.x + wall.width + 1 && y >= wall.y - 1 && y <= wall.y + wall.height + 1; }
function overlaps(a: Wall, b: Wall) { return a.x < b.x + b.width + .15 && a.x + a.width + .15 > b.x && a.y < b.y + b.height + .15 && a.y + a.height + .15 > b.y; }
function message(problem: unknown) { return problem instanceof Error ? problem.message : 'Не удалось выполнить действие.'; }
