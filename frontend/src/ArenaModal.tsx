import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ArenaModal({ title, onClose, children, wide = false }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return () => { node?.close(); opener?.focus({ preventScroll: true }); };
  }, []);

  return <dialog ref={dialog} className={`arena-modal arena-modal-native${wide ? ' wide' : ''}`}
    aria-labelledby={titleId} onKeyDown={event => {
      if (event.key !== 'Tab' || !dialog.current) return;
      const controls = [...dialog.current.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
        .filter(node => !node.matches(':disabled') && node.tabIndex >= 0 && node.getClientRects().length > 0);
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }} onCancel={event => { event.preventDefault(); onClose(); }}
    onClick={event => {
      if (event.target !== dialog.current) return;
      const bounds = dialog.current.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    }}>
    <header><h2 id={titleId}>{title}</h2><button type="button" className="arena-modal-close" onClick={onClose} aria-label="Закрыть">×</button></header>
    <div className="arena-modal-body">{children}</div>
  </dialog>;
}
