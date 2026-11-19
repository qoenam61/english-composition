import { describe, expect, it } from "vitest";
import { applyAttempt, chapterBoard, nextBox, nextDue, pickNext, needsTempUnlock, type PatternProgress } from "../src/index.js";

const fresh = (id = 1): PatternProgress => ({ patternId: id, streak: 0, state: "new", hintOnlyStreak: 0, consecutiveFails: 0, seenSentenceIds: [] });
const pass = { verdict: "PASS" as const, usedHint: false, overTime: false };

describe("completion", () => {
  it("연속 2회 정답이면 완료", () => {
    const a = applyAttempt(fresh(), pass);
    expect(a.state).toBe("learning");
    expect(applyAttempt(a, pass).state).toBe("done");
  });
  it("힌트 정답은 카운트를 올리지 않는다", () => {
    expect(applyAttempt(fresh(), { ...pass, usedHint: true }).streak).toBe(0);
  });
  it("FAIL은 0으로 되돌린다", () => {
    const a = applyAttempt(fresh(), pass);
    expect(applyAttempt(a, { ...pass, verdict: "FAIL" }).streak).toBe(0);
  });
  it("MINOR_TYPO는 유지한다", () => {
    const a = applyAttempt(fresh(), pass);
    expect(applyAttempt(a, { ...pass, verdict: "MINOR_TYPO" }).streak).toBe(1);
  });
  it("시간 초과는 올리지 않고 틀림도 아니다", () => {
    const a = applyAttempt(fresh(), pass);
    const b = applyAttempt(a, { ...pass, overTime: true });
    expect(b.streak).toBe(1);
    expect(b.consecutiveFails).toBe(0);
  });
  it("5회 연속 실패면 임시 해금", () => {
    let p = fresh();
    for (let i = 0; i < 5; i++) p = applyAttempt(p, { ...pass, verdict: "FAIL" });
    expect(needsTempUnlock(p)).toBe(true);
  });
  it("입력을 바꾸지 않는다", () => {
    const p = fresh(); applyAttempt(p, pass);
    expect(p.streak).toBe(0);
  });
});

describe("srs", () => {
  it("1→3→7→14일", () => {
    const day = 86_400_000;
    expect([0, 1, 2, 3, 9].map((b) => nextDue(b, 0) / day)).toEqual([1, 3, 7, 14, 14]);
    expect(nextBox(3, true)).toBe(3);
    expect(nextBox(2, false)).toBe(0);
  });
});

describe("chapter", () => {
  it("남은 개수와 배지", () => {
    const m = new Map<number, PatternProgress>([[1, { ...fresh(1), state: "done" }], [2, fresh(2)]]);
    const b = chapterBoard([1, 2, 3], m);
    expect(b).toMatchObject({ total: 3, done: 1, remaining: 2, badges: [true, false, false], complete: false });
  });
});

describe("picker", () => {
  const seq = (...v: number[]) => { let i = 0; return () => v[i++ % v.length]!; };
  it("완료 패턴은 출제하지 않고 직전 패턴을 연속 차단한다", () => {
    const progress = new Map<number, PatternProgress>([[1, { ...fresh(1), state: "done" }], [2, fresh(2)], [3, fresh(3)]]);
    const sent = new Map([[2, [20, 21]], [3, [30]]]);
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const p = pickNext({ chapterPatternIds: [1, 2, 3], progress, sentencesByPattern: sent, dueReviewPatternIds: [], lastPatternId: 2, rng: seq(r) })!;
      expect(p.patternId).toBe(3);
    }
  });
  it("미출제 문장을 우선한다", () => {
    const progress = new Map<number, PatternProgress>([[2, { ...fresh(2), seenSentenceIds: [20] }]]);
    const p = pickNext({ chapterPatternIds: [2], progress, sentencesByPattern: new Map([[2, [20, 21]]]), dueReviewPatternIds: [], rng: seq(0) })!;
    expect(p.sentenceId).toBe(21);
  });
  it("챕터 완료 후 복습이 없으면 출제할 것이 없다", () => {
    const progress = new Map([[1, { ...fresh(1), state: "done" as const }]]);
    expect(pickNext({ chapterPatternIds: [1], progress, sentencesByPattern: new Map([[1, [10]]]), dueReviewPatternIds: [], rng: seq(0.5) })).toBeUndefined();
  });
  it("복습일이 된 완료 패턴은 복습으로 섞인다", () => {
    const progress = new Map<number, PatternProgress>([[1, { ...fresh(1), state: "done" }], [2, fresh(2)]]);
    const p = pickNext({ chapterPatternIds: [1, 2], progress, sentencesByPattern: new Map([[1, [10]], [2, [20]]]), dueReviewPatternIds: [1], rng: seq(0.01, 0) })!;
    expect(p).toMatchObject({ patternId: 1, review: true });
  });
});
