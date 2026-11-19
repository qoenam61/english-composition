import { describe, expect, it } from "vitest";
import { summarize } from "../src/index.js";

const D = 86_400_000; const base = Date.UTC(2026, 10, 19, 3, 0, 0); // KST 정오
const a = (i: number, dd: number, verdict: "PASS" | "FAIL", hint = false) => ({ patternId: 1, sentenceId: i, verdict, usedHint: hint, overTime: false, elapsedMs: 4000, input: "x", at: base - dd * D });
describe("stats", () => {
  it("연속 학습일과 첫 시도 정답률", () => {
    const s = summarize([a(1, 0, "PASS"), a(2, 0, "FAIL"), a(1, 0, "PASS"), a(3, 1, "PASS"), a(4, 3, "PASS")], [{ patternId: 1, at: base }], base);
    expect(s.streakDays).toBe(2);
    expect(s.today).toMatchObject({ attempts: 3, patternsCompleted: 1 });
    expect(s.today.firstTryCorrectRate).toBeCloseTo(0.5);
    expect(s.totalCompleted).toBe(1);
  });
  it("힌트 정답은 첫 시도 정답으로 세지 않는다", () => {
    expect(summarize([a(1, 0, "PASS", true)], [], base).today.firstTryCorrectRate).toBe(0);
  });
  it("오늘 기록이 없으면 연속은 0", () => expect(summarize([a(1, 2, "PASS")], [], base).streakDays).toBe(0));
});
