import type { AttemptInput, PatternProgress } from "./types.js";

export const COMPLETE_STREAK = 2;
export const TEMP_UNLOCK_FAILS = 5;

/** 시도 1회를 반영한 새 진행 상태. 입력을 바꾸지 않는다(순수 함수). */
export function applyAttempt(p: PatternProgress, a: AttemptInput): PatternProgress {
  if (p.state === "done") return p;
  const next = { ...p };
  if (a.verdict === "MINOR_TYPO") return next; // 올리지도 초기화하지도 않음, 다시 입력
  if (a.verdict === "FAIL") {
    next.streak = 0;
    next.hintOnlyStreak = 0;
    next.consecutiveFails = p.consecutiveFails + 1;
    next.state = "learning";
    return next;
  }
  // PASS
  next.consecutiveFails = 0;
  if (a.usedHint) {
    next.hintOnlyStreak = p.hintOnlyStreak + 1; // 힌트 정답은 카운트를 올리지 않음
    next.state = "learning";
    return next;
  }
  if (a.overTime) { // 시간 기록: 틀림도 아니고 카운터도 올리지 않음
    next.state = "learning";
    return next;
  }
  next.streak = p.streak + 1;
  next.state = next.streak >= COMPLETE_STREAK ? "done" : "learning";
  return next;
}

export function needsTempUnlock(p: PatternProgress): boolean {
  return p.consecutiveFails >= TEMP_UNLOCK_FAILS;
}
