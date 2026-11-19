export interface Board { total: number; done: number; remaining: number; badges: boolean[]; complete: boolean }
export interface Card { sentenceId: number; patternId: number; ko: string; context?: string; review: boolean; hintAvailable: boolean; timeLimitSec: number; patternNo: number; patternTemplate: string; level: string; board: Board; chapterId: number; mode: "chapter" | "weak" | "free" }
export type Verdict = "PASS" | "MINOR_TYPO" | "FAIL";
export type Submit = { kind: "graded"; verdict: Verdict; answer: string; patternCompleted: boolean; chapterCompleted: boolean; board: Board } | { kind: "error"; message: string };
export interface Summary { kind: "weak" | "free"; total: number; answered: number; correct: number; avgMs: number; firstTryPct: number; grade: "S" | "A" | "B" | "C"; missedPatternIds: number[]; patterns: string[] }
export type ErrType = "pattern_order" | "article_prep" | "vocab" | "tense";
export interface WrongItem { patternId: number; sentenceId: number; wrongCount: number; lastWrongInput: string; lastWrongAt: number; ko: string; answer: string; template: string; error: { type: ErrType; label: string; comment: string } }
export interface DoneItem { patternId: number; completedAt: number; ko: string; en: string; template: string }
export interface Notes { wrong: WrongItem[]; completed: DoneItem[]; typeCount: Partial<Record<ErrType, number>>; top3: Array<{ patternId: number; template: string; wrongCount: number }> }
export interface Chapter { chapterId: number; level: string; total: number; done: number; status: "done" | "current" | "locked" }
export interface Overview { chapters: Chapter[]; currentChapterId?: number; activeChapterId?: number; header: { streakDays: number; mastered: number; wrongCount: number }; totalPatterns: number; totalDone: number }
export interface Stats { streakDays: number; totalAttempts: number; days: Array<{ date: string }> }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`요청 실패 (${r.status})`);
  return r.json() as Promise<T>;
}
export const api = {
  next: () => call<{ card: Card | null; summary: Summary | null }>("/api/next"),
  submit: (sentenceId: number, input: string, usedHint: boolean, elapsedMs: number) => call<Submit>("/api/submit", { sentenceId, input, usedHint, elapsedMs }),
  hint: (sentenceId: number) => call<{ hint: string | null }>("/api/hint", { sentenceId }),
  notes: () => call<Notes>("/api/notes"),
  stats: () => call<Stats>("/api/stats"),
  overview: () => call<Overview>("/api/overview"),
  open: (chapter?: number) => call<{ ok: boolean }>(chapter ? `/api/open?chapter=${chapter}` : "/api/open"),
  practice: (kind: "weak" | "free", q: Record<string, string | number | undefined> = {}) => {
    const p = new URLSearchParams({ kind, ...Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])) });
    return call<{ ok: true; total: number } | { ok: false; reason: string }>(`/api/practice?${p}`);
  },
  exitPractice: () => call<{ ok: boolean }>("/api/practice/exit"),
  uncomplete: (patternId: number) => call<{ chapterId: number }>("/api/uncomplete", { patternId }),
};
