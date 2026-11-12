import { useEffect, useRef } from 'react';
import { minimalSetup, EditorView } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { Compartment } from '@codemirror/state';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { useTheme } from './useTheme';
import { python } from '@codemirror/lang-python';
import type { StrategyLanguage } from './contracts';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { text } from './text';

const lightTheme = [EditorView.theme({
  '&': { backgroundColor: '#f8fbfd', color: '#193448' },
  '.cm-content': { caretColor: '#126d89' },
  '.cm-gutters': { backgroundColor: '#edf3f7', color: '#607787', borderRight: '1px solid #cbd9e2' },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: '#e5f0f5' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: '#b7dcec' },
  '&.cm-focused': { outline: '2px solid #298aa6', outlineOffset: '-2px' },
}, { dark: false }), syntaxHighlighting(defaultHighlightStyle)];

export default function StrategyEditor({ initialCode, language, onChange }: {
  initialCode: string;
  language: StrategyLanguage;
  onChange: (code: string) => void;
}) {
  const theme = useTheme();
  const themeCompartment = useRef(new Compartment());
  const changed = useRef(onChange);
  changed.current = onChange;
  const parent = useRef<HTMLDivElement>(null);
  const editor = useRef<EditorView | null>(null);

  useEffect(() => {
    editor.current = new EditorView({
      doc: initialCode,
      parent: parent.current!,
      extensions: [
        minimalSetup,
        lineNumbers(),
        language === "python" ? python() : javascript(),
        themeCompartment.current.of(theme === 'light' ? lightTheme : oneDark),
        EditorView.contentAttributes.of({ id: 'strategy', 'aria-label': text.strategy }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) changed.current(update.state.doc.toString());
        }),
      ],
    });
    return () => { editor.current?.destroy(); editor.current = null; };
  }, [language]);

  useEffect(() => {
    editor.current?.dispatch({ effects: themeCompartment.current.reconfigure(theme === 'light' ? lightTheme : oneDark) });
  }, [theme, language]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === initialCode) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: initialCode } });
  }, [initialCode]);

  return <div className="code-editor" ref={parent} />;
}
