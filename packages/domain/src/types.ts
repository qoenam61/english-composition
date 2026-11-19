/** OK_NO_COUNT: 문법·의미는 맞지만 목표 패턴을 쓰지 않은 정답. 감점 없이 정답으로 보이되 패턴 진도에는 반영하지 않는다. */
export type Verdict = "PASS" | "MINOR_TYPO" | "FAIL" | "OK_NO_COUNT";
export type PatternState = "new" | "learning" | "done";

export interface PatternProgress {
  patternId: number;
  streak: number;
  state: PatternState;
  hintOnlyStreak: number;
  consecutiveFails: number;
  seenSentenceIds: number[];
  lastSeenAt?: number;
}

export interface AttemptInput {
  verdict: Verdict;
  usedHint: boolean;
  overTime: boolean;
}
