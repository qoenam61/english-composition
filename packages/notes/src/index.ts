import type { AttemptGraded, PatternCompleted } from "@app/contracts";

export interface WrongNote { patternId: number; sentenceId: number; wrongCount: number; lastWrongInput: string; lastWrongAt: number }
export interface CompletedNote { patternId: number; completedAt: number }
export interface NotesState { wrong: Map<number, WrongNote>; completed: Map<number, CompletedNote> }

export const emptyNotes = (): NotesState => ({ wrong: new Map(), completed: new Map() });

/** 오답: FAIL 만 등록한다(MINOR_TYPO·시간 초과·채점 오류는 등록하지 않음). 완료 노트에 있던 패턴이 다시 틀리면 오답노트로 복귀. */
export function onAttemptGraded(s: NotesState, e: AttemptGraded, now: number): NotesState {
  if (e.verdict !== "FAIL") return s;
  const wrong = new Map(s.wrong); const completed = new Map(s.completed);
  const prev = wrong.get(e.patternId);
  wrong.set(e.patternId, { patternId: e.patternId, sentenceId: e.sentenceId, wrongCount: (prev?.wrongCount ?? 0) + 1, lastWrongInput: e.input, lastWrongAt: now });
  completed.delete(e.patternId);
  return { wrong, completed };
}

/** 패턴 완료: 오답노트에서 학습완료노트로 자동 이동. */
export function onPatternCompleted(s: NotesState, e: PatternCompleted, now: number): NotesState {
  const wrong = new Map(s.wrong); const completed = new Map(s.completed);
  wrong.delete(e.patternId);
  completed.set(e.patternId, { patternId: e.patternId, completedAt: now });
  return { wrong, completed };
}

/** 정렬: 횟수 많은 순, 같으면 최근 순. */
export function sortedWrong(s: NotesState): WrongNote[] {
  return [...s.wrong.values()].sort((a, b) => b.wrongCount - a.wrongCount || b.lastWrongAt - a.lastWrongAt);
}

export function onPatternUncompleted(s: NotesState, patternId: number): NotesState {
  const completed = new Map(s.completed); completed.delete(patternId);
  return { wrong: s.wrong, completed };
}

export type ErrorType = "pattern_order" | "article_prep" | "vocab" | "tense";
export interface ErrorInfo { type: ErrorType; label: string; comment: string }

const ART_PREP = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "for", "with", "by", "from", "about", "into", "over", "up", "off", "out"]);
const nw = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, "");
const words = (s: string) => s.trim().split(/\s+/).map(nw).filter(Boolean);
const stem = (w: string) => w.replace(/(ing|ed|es|s|d)$/, "");

/** 단어 비교로 오류 유형을 추정한다(규칙 기반 — 틀릴 수 있다). */
export function classifyError(user: string, answer: string, patternWords: string[] = []): ErrorInfo {
  const u = words(user), a = words(answer);
  const missing = a.filter((w) => !u.includes(w)), extra = u.filter((w) => !a.includes(w));
  if (u.length === a.length && !missing.length && !extra.length && u.join(" ") !== a.join(" "))
    return { type: "pattern_order", label: "패턴/어순", comment: "단어는 맞지만 순서가 달라요. 정답의 어순을 입으로 따라 읽어 보세요." };
  const diff = [...missing, ...extra];
  if (diff.length && diff.every((w) => ART_PREP.has(w)))
    return { type: "article_prep", label: "관사/전치사", comment: `관사·전치사가 빠졌거나 달라요 (${diff.join(", ")}). 덩어리째 외우면 덜 틀려요.` };
  if (missing.length && extra.length && missing.some((m) => extra.some((e) => stem(m) === stem(e) && m !== e)))
    return { type: "tense", label: "시제/수일치", comment: "단어 형태(시제·단수/복수·-s)가 달라요. 주어와 시제를 다시 확인하세요." };
  if (patternWords.length && patternWords.some((p) => !u.includes(nw(p))))
    return { type: "pattern_order", label: "패턴/어순", comment: "핵심 패턴 표현이 빠졌어요. 힌트로 패턴을 먼저 떠올려 보세요." };
  return { type: "vocab", label: "어휘 선택", comment: `다른 단어를 썼어요 (${(missing.slice(0, 3).join(", ")) || "?"} 대신 ${(extra.slice(0, 3).join(", ")) || "?"}).` };
}
