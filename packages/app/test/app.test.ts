import { describe, expect, it } from "vitest";
import type { ContentRepository, SentenceRef } from "@app/contracts";
import { GradingService } from "@app/grading";
import { SqliteUserStore } from "@app/adapter-userdb";
import { StudyService, timeLimitSec } from "../src/index.js";

const sent = (pid: number, i: number): SentenceRef => ({ sentenceId: pid * 10 + i, patternId: pid, track: "original", en: `I like pattern ${pid} number ${i}.`, ko: `패턴 ${pid} 문장 ${i}`, mustUse: "like", answers: [`I like pattern ${pid} number ${i}.`] });
const content: ContentRepository = {
  chapters: async () => [{ chapterId: 1, level: "A1", patternIds: [1, 2, 3] }, { chapterId: 2, level: "A1", patternIds: [4] }],
  pattern: async () => undefined,
  sentences: async (p) => [sent(p, 1), sent(p, 2)],
};
const lcg = (s: number) => () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
const mk = (store = new SqliteUserStore(), clock = { t: 1_000_000 }) =>
  ({ svc: new StudyService({ userId: "u", content, store, grading: new GradingService(), rng: lcg(2), now: () => clock.t, tracks: ["original"] }), store, clock });

describe("StudyService", () => {
  it("챕터를 완주하면 완료 노트·복습 일정이 생기고, 재접속하면 다음 챕터에서 이어간다", async () => {
    const { svc, store, clock } = mk();
    await svc.open();
    let last; let n = 0;
    for (let c = svc.next(); c; c = svc.next(), n++) {
      const s = (await content.sentences(c.patternId, ["original"])).find((x) => x.sentenceId === c.sentenceId)!;
      last = await svc.submit(c.sentenceId, s.en, false, 1000);
      if (last.kind === "graded" && last.chapterCompleted) break;
    }
    expect(n + 1).toBe(6);
    expect(svc.notesView().completed).toHaveLength(3);
    expect(await store.dueReviews("u", clock.t)).toEqual([]);
    expect(await store.dueReviews("u", clock.t + 86_400_000 + 1)).toHaveLength(3);
    const again = mk(store, clock).svc;
    const board = await again.open();
    expect(board.total).toBe(1); // 다음 챕터(패턴 1개)로 이어하기
  });
  it("오답은 오답노트에 쌓이고, 채점 오류는 카운터를 바꾸지 않는다", async () => {
    const { svc } = mk();
    await svc.open(); const c = svc.next()!;
    const r = await svc.submit(c.sentenceId, "totally different words", false, 1000);
    expect(r).toMatchObject({ kind: "graded", verdict: "FAIL" });
    expect(svc.notesView().wrong).toHaveLength(1);
    const g = new GradingService({ judge: async () => { throw new Error("down"); } });
    const e = new StudyService({ userId: "x", content, store: new SqliteUserStore(), grading: g, rng: lcg(1), now: () => 0, tracks: ["original"] });
    await e.open(); const cc = e.next()!;
    expect((await e.submit(cc.sentenceId, "totally different words", false, 0)).kind).toBe("error");
    expect(e.notesView().wrong).toHaveLength(0);
  });
  it("재접속해도 오답노트가 복원되고 통계가 쌓인다", async () => {
    const { svc, store, clock } = mk();
    await svc.open(); const c = svc.next()!;
    await svc.submit(c.sentenceId, "totally different words", false, 3000);
    const again = mk(store, clock).svc; await again.open();
    expect(again.notesView().wrong).toHaveLength(1);
    expect((await again.statsView()).today.attempts).toBe(1);
  });
  it("제한 시간은 문장 길이로 정한다", () => {
    expect([timeLimitSec("a b c"), timeLimitSec("a b c d e f g h"), timeLimitSec("a b c d e f g h i j k l m")]).toEqual([15, 20, 30]);
  });
});
