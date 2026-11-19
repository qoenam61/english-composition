import { applyAttempt, chapterBoard, pickNext, type AttemptInput, type ChapterBoard, type PatternProgress, type Pick } from "@app/domain";
import type { AppEvent } from "@app/contracts";

export interface SessionDeps {
  chapterId: number;
  patternIds: number[];
  sentencesByPattern: Map<number, number[]>;
  progress: Map<number, PatternProgress>;
  dueReviewPatternIds?: number[];
  rng: () => number;
  emit?: (e: AppEvent) => void;
}

/** 화면 없는 학습 세션 상태머신: next() -> submit() 반복. */
export class Session {
  private last?: Pick;
  constructor(private d: SessionDeps) {}

  board(): ChapterBoard { return chapterBoard(this.d.patternIds, this.d.progress); }

  next(): Pick | undefined {
    const p = pickNext({
      chapterPatternIds: this.d.patternIds, progress: this.d.progress,
      sentencesByPattern: this.d.sentencesByPattern, dueReviewPatternIds: this.d.dueReviewPatternIds ?? [],
      lastPatternId: this.last?.patternId, rng: this.d.rng,
    });
    this.last = p;
    return p;
  }

  submit(a: AttemptInput): { board: ChapterBoard; patternCompleted: boolean; chapterCompleted: boolean } {
    const cur = this.last;
    if (!cur) throw new Error("next() 를 먼저 호출해야 한다");
    const before = this.d.progress.get(cur.patternId) ?? { patternId: cur.patternId, streak: 0, state: "new", hintOnlyStreak: 0, consecutiveFails: 0, seenSentenceIds: [] } as PatternProgress;
    const seen = before.seenSentenceIds.includes(cur.sentenceId) ? before.seenSentenceIds : [...before.seenSentenceIds, cur.sentenceId];
    const after = applyAttempt({ ...before, seenSentenceIds: seen }, a);
    this.d.progress.set(cur.patternId, after);
    const board = this.board();
    const patternCompleted = before.state !== "done" && after.state === "done";
    if (patternCompleted) this.d.emit?.({ v: 1, type: "PatternCompleted", patternId: cur.patternId, chapterId: this.d.chapterId });
    const chapterCompleted = patternCompleted && board.complete;
    if (chapterCompleted) this.d.emit?.({ v: 1, type: "ChapterCompleted", chapterId: this.d.chapterId });
    return { board, patternCompleted, chapterCompleted };
  }
}
