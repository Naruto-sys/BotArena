import type { StrategyLanguage } from './contracts';
import { text } from './text';

function Fields({ title, rows }: { title: string; rows: readonly (readonly [string, string, string])[] }) {
  return (
    <table className="strategy-fields">
      <caption>{title}</caption>
      <thead><tr>{text.help.columns.map(column => <th key={column} scope="col">{column}</th>)}</tr></thead>
      <tbody>
        {rows.map(([field, type, description]) => (
          <tr key={field}>
            <th scope="row"><code>{field}</code></th>
            <td><code>{type}</code></td>
            <td>{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function StrategyHelp({ language }: { language: StrategyLanguage }) {
  return (
    <details>
      <summary>{text.help.title}</summary>
      <p>{language === 'python' ? text.help.pythonIntro : text.help.intro}</p>
      <Fields title={text.help.input} rows={text.help.inputFields} />
      <Fields title={text.help.output} rows={text.help.outputFields} />
      <p>{text.help.turretIntro}</p>
      {language === 'python' && <p>{text.help.turretPythonImport}</p>}
      <Fields title={text.help.turretFunctions} rows={text.help.turretRows} />
      <Fields title={text.help.nested} rows={text.help.nestedFields} />
    </details>
  );
}
