import { describe, expect, it } from "vitest";
import { SqliteUserStore } from "../src/index.js";

describe("SqliteUserStore", () => {
  it("진도를 저장하고 그대로 읽는다", async () => {
    const s = new SqliteUserStore();
    await s.saveProgress("u", { patternId: 1, streak: 1, state: "learning", hintOnlyStreak: 0, consecutiveFails: 0, seenSentenceIds: [10] });
    expect((await s.progress("u")).get(1)).toMatchObject({ streak: 1, seenSentenceIds: [10] });
    expect((await s.progress("other")).size).toBe(0);
  });
  it("복습일이 도래한 패턴만 돌려준다", async () => {
    const s = new SqliteUserStore();
    await s.saveSchedule("u", 1, 0, 100); await s.saveSchedule("u", 2, 0, 500);
    expect(await s.dueReviews("u", 200)).toEqual([1]);
  });
  it("시도는 원시 기록으로 남는다", async () => {
    const s = new SqliteUserStore();
    await s.recordAttempt("u", { v: 1, type: "AttemptGraded", sentenceId: 1, patternId: 1, verdict: "FAIL", usedHint: false, overTime: false, input: "x", graderVersion: "t" });
    await s.recordAttempt("u", { v: 1, type: "AttemptGraded", sentenceId: 1, patternId: 1, verdict: "PASS", usedHint: false, overTime: false, input: "y", graderVersion: "t" });
    expect(await s.dueReviews("u", 0)).toEqual([]);
  });
});
