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
