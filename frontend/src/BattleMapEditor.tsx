import { useEffect, useState } from 'react';
import type { BattleMap } from './contracts';
import { isUnauthorized, requireLogin, ugcApi } from './ugcApi';

export function BattleMapEditor({ onPlayMap, onCreateMap }: {
  onPlayMap: (map: BattleMap) => void;
  onCreateMap: () => void;
}) {
  const [maps, setMaps] = useState<BattleMap[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void ugcApi.maps().then(items => { if (active) setMaps(items); }).catch(problem => {
      if (!active) return;
      if (isUnauthorized(problem)) requireLogin(); else setError(message(problem));
    });
    return () => { active = false; };
  }, []);
  async function removeMap(map: BattleMap) {
    if (!confirm(`Удалить карту «${map.name}»? Уже созданные комнаты сохранят её снимок.`)) return;
    try { await ugcApi.deleteMap(map.id); setMaps(items => items.filter(item => item.id !== map.id)); }
    catch (problem) { setError(message(problem)); }
  }
  return <section className="map-library">
    <div className="ugc-section-head"><div><h2>Карты</h2><p>Создавайте, редактируйте и проверяйте карты на Арене. Сохранённые карты доступны в PvP-комнатах.</p></div><button className="primary" onClick={onCreateMap}>+ Создать карту</button></div>
    {error && <p role="alert" className="error-card">{error}</p>}
    <div className="map-card-grid">{maps.map(map => <article className="map-card" key={map.id}>
      <MapPreview map={map} /><div><h3>{map.name}</h3><small>{map.walls.length} препятствий</small></div>
      <footer><button className="primary" onClick={() => onPlayMap(map)}>Играть на карте</button><button onClick={() => onPlayMap(map)}>Редактировать</button><button className="danger-button" onClick={() => void removeMap(map)}>Удалить</button></footer>
    </article>)}{!maps.length && <div className="ugc-empty"><b>Личных карт пока нет</b><p>Создайте карту на Арене и сохраните её — она появится здесь.</p></div>}</div>
  </section>;
}
function MapPreview({ map }: { map: BattleMap }) {
  return <svg className="map-preview" viewBox={`0 0 ${map.width} ${map.height}`}><rect width={map.width} height={map.height} /><circle cx="2" cy="5" r=".35" /><circle cx="14" cy="5" r=".35" />{map.walls.map((wall, index) => <rect key={index} {...wall} />)}</svg>;
}
function message(problem: unknown) { return problem instanceof Error ? problem.message : 'Не удалось выполнить действие.'; }
