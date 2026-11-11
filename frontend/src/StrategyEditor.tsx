import { useEffect, useRef } from 'react';
import { minimalSetup, EditorView } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import type { StrategyLanguage } from './contracts';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import { text } from './text';

export default function StrategyEditor({ initialCode, language, onChange }: {
  initialCode: string;
  language: StrategyLanguage;
  onChange: (code: string) => void;
}) {
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
        oneDark,
        EditorView.contentAttributes.of({ id: 'strategy', 'aria-label': text.strategy }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) changed.current(update.state.doc.toString());
        }),
      ],
    });
    return () => { editor.current?.destroy(); editor.current = null; };
  }, [language]);

  useEffect(() => {
    const view = editor.current;
    if (!view || view.state.doc.toString() === initialCode) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: initialCode } });
  }, [initialCode]);

  return <div className="code-editor" ref={parent} />;
}
