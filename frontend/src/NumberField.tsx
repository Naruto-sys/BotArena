import { useEffect, useId, useState } from 'react';

/** Allow a temporary empty draft while keeping the accepted value within bounds. */
export function NumberField({ label, value, min, max, buttonStep = 1, onChange }: {
  label: string; value: number; min: number; max: number; buttonStep?: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  return <div className="number-field"><label htmlFor={id}>{label}</label>
    <div className="number-stepper">
      <button type="button" aria-label={`Уменьшить: ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - buttonStep))}>−</button>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} step={1} value={draft}
        onChange={event => {
          setDraft(event.target.value);
          const next = Number(event.target.value);
          if (event.target.value !== '' && Number.isInteger(next) && next >= min && next <= max) onChange(next);
        }} onBlur={() => {
          const next = draft.trim() === '' ? value : Number(draft);
          if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, Math.round(next))));
          setDraft(String(value));
        }} />
      <button type="button" aria-label={`Увеличить: ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + buttonStep))}>+</button>
    </div>
  </div>;
}
