/** Reveal a workspace panel below the sticky application header. */
export function scrollToPanel(panel: HTMLElement | null) {
  if (!panel) return;
  const header = document.querySelector('.platform-header')?.getBoundingClientRect().height ?? 0;
  const top = panel.getBoundingClientRect().top + window.scrollY - header - 12;
  window.scrollTo({ top: Math.max(0, top), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}
