export type Verdict = "PASS" | "MINOR_TYPO" | "FAIL";
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
