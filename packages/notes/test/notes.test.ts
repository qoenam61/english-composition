import { describe, expect, it } from "vitest";
import { emptyNotes, onAttemptGraded, onPatternCompleted, sortedWrong } from "../src/index.js";
import type { AttemptGraded } from "@app/contracts";

const ev = (patternId: number, verdict: AttemptGraded["verdict"], input = "x"): AttemptGraded => ({ v: 1, type: "AttemptGraded", sentenceId: patternId * 10, patternId, verdict, usedHint: false, overTime: false, input, graderVersion: "t" });

describe("notes", () => {
  it("FAIL 만 오답노트에 등록하고 횟수를 센다", () => {
    let s = emptyNotes();
    s = onAttemptGraded(s, ev(1, "FAIL", "a"), 1); s = onAttemptGraded(s, ev(1, "FAIL", "b"), 2);
    s = onAttemptGraded(s, ev(2, "MINOR_TYPO"), 3); s = onAttemptGraded(s, ev(3, "PASS"), 4);
    expect([...s.wrong.keys()]).toEqual([1]);
    expect(s.wrong.get(1)).toMatchObject({ wrongCount: 2, lastWrongInput: "b" });
  });
  it("완료하면 학습완료노트로 이동하고, 다시 틀리면 오답노트로 복귀", () => {
    let s = onAttemptGraded(emptyNotes(), ev(1, "FAIL"), 1);
    s = onPatternCompleted(s, { v: 1, type: "PatternCompleted", patternId: 1, chapterId: 1 }, 2);
    expect(s.wrong.size).toBe(0); expect(s.completed.has(1)).toBe(true);
    s = onAttemptGraded(s, ev(1, "FAIL"), 3);
    expect(s.completed.has(1)).toBe(false); expect(s.wrong.has(1)).toBe(true);
  });
  it("횟수 → 최근 순으로 정렬", () => {
    let s = emptyNotes();
    s = onAttemptGraded(s, ev(1, "FAIL"), 1); s = onAttemptGraded(s, ev(2, "FAIL"), 2); s = onAttemptGraded(s, ev(2, "FAIL"), 3); s = onAttemptGraded(s, ev(3, "FAIL"), 4);
    expect(sortedWrong(s).map((n) => n.patternId)).toEqual([2, 3, 1]);
  });
});
