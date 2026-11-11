import { useEffect, useRef } from 'react';
import { minimalSetup, EditorView } from 'codemirror';
import { lineNumbers } from '@codemirror/view';
import { python } from '@codemirror/lang-python';
import type { StrategyLanguage } from './contracts';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';

export default function StrategyEditor({ initialCode, language, onChange }: {
  initialCode: string;
  language: StrategyLanguage;
  onChange: (code: string) => void;
}) {
  const initial = useRef(initialCode);
  const changed = useRef(onChange);
  changed.current = onChange;
  const parent = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const editor = new EditorView({
      doc: initial.current,
      parent: parent.current!,
      extensions: [
        minimalSetup,
        lineNumbers(),
        language === "python" ? python() : javascript(),
        oneDark,
        EditorView.contentAttributes.of({ id: 'strategy', 'aria-labelledby': 'strategy-label' }),
        EditorView.updateListener.of(update => {
          if (update.docChanged) changed.current(update.state.doc.toString());
        }),
      ],
    });
    return () => editor.destroy();
  }, [language]);

  return <div className="code-editor" ref={parent} />;
}
