import type { MatchJobStatus, MatchResponse, ScriptError, StrategyLanguage } from './contracts';
import { text } from './text';

export class MatchDiagnosticError extends Error {
  constructor(readonly diagnostic: ScriptError) {
    super(diagnostic.message);
  }
}

export async function runMatch(
  botCode: string,
  opponentId: string,
  language: StrategyLanguage,
  signal: AbortSignal,
  onStatus: (status: MatchJobStatus) => void,
): Promise<MatchResponse> {
  const response = await fetch('/api/match-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ botCode, opponentId, language }),
    signal,
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('Войдите через Yandex ID, чтобы запустить матч.');
    const problem = await response.json().catch(() => null);
    throw new Error(response.status === 429 ? text.queueFull : problem?.error ?? text.serverError(response.status));
  }

  const { id }: { id: string } = await response.json();
  let failures = 0;
  while (!signal.aborted) {
    let update: Response;
    try {
      update = await fetch(`/api/match-jobs/${id}`, { signal });
      failures = 0;
    } catch (error) {
      if (signal.aborted || ++failures >= 3) throw error;
      await new Promise(resolve => setTimeout(resolve, 300));
      continue;
    }
    if (!update.ok) throw new Error(update.status === 404 ? text.jobMissing : text.serverError(update.status));
    const status: MatchJobStatus = await update.json();
    if (status.state === 'completed') {
      if (status.diagnostic) throw new MatchDiagnosticError(status.diagnostic);
      if (!status.match) throw new Error(status.error ?? text.matchError);
      return status.match;
    }
    onStatus(status);
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  throw signal.reason;
}
