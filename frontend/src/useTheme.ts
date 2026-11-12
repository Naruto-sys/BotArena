import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

export function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/** Observe the shared theme without remounting editors or WebGL scenes. */
export function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const update = () => setTheme(readTheme());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    update();
    return () => observer.disconnect();
  }, []);
  return theme;
}
