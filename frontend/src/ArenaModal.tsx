import { useEffect, type ReactNode } from 'react';

export function ArenaModal({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose]);

  return <div className="arena-modal-backdrop" role="presentation" onMouseDown={event => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className={`arena-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="arena-modal-title">
      <header><h2 id="arena-modal-title">{title}</h2><button type="button" className="arena-modal-close" onClick={onClose} aria-label="Закрыть">×</button></header>
      <div className="arena-modal-body">{children}</div>
    </section>
  </div>;
}
