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
    expect((await svc.notesView()).completed).toHaveLength(3);
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
    expect((await svc.notesView()).wrong).toHaveLength(1);
    const g = new GradingService({ judge: async () => { throw new Error("down"); } });
    const e = new StudyService({ userId: "x", content, store: new SqliteUserStore(), grading: g, rng: lcg(1), now: () => 0, tracks: ["original"] });
    await e.open(); const cc = e.next()!;
    expect((await e.submit(cc.sentenceId, "totally different words", false, 0)).kind).toBe("error");
    expect((await e.notesView()).wrong).toHaveLength(0);
  });
  it("재접속해도 오답노트가 복원되고 통계가 쌓인다", async () => {
    const { svc, store, clock } = mk();
    await svc.open(); const c = svc.next()!;
    await svc.submit(c.sentenceId, "totally different words", false, 3000);
    const again = mk(store, clock).svc; await again.open();
    expect((await again.notesView()).wrong).toHaveLength(1);
    expect((await again.statsView()).today.attempts).toBe(1);
  });
  it("자유 훈련(취약 패턴): 오답 패턴만 출제하고 진도는 바꾸지 않으며 요약을 낸다", async () => {
    const { svc, store } = mk();
    expect(await svc.startPractice("weak")).toMatchObject({ ok: false }); // 빈 상태에서 시도해도
    await svc.open(); const c = svc.next()!;
    await svc.submit(c.sentenceId, "totally different words", false, 1000); // 오답노트 등록
    const before = (await store.progress("u")).get(c.patternId);
    const st = await svc.startPractice("weak");
    expect(st).toEqual({ ok: true, total: 2 }); // 패턴 1개, 문장 2개
    let n = 0;
    for (let k = svc.next(); k; k = svc.next(), n++) {
      expect(k.mode).toBe("weak"); expect(k.patternId).toBe(c.patternId);
      const s2 = (await content.sentences(k.patternId, ["original"])).find((x) => x.sentenceId === k.sentenceId)!;
      const r = await svc.submit(k.sentenceId, n === 0 ? s2.en : "wrong wrong", false, 2000);
      expect(r).toMatchObject({ kind: "graded" });
    }
    expect(n).toBe(2);
    expect(svc.practiceSummary()).toMatchObject({ total: 2, correct: 1, missedPatternIds: [c.patternId] });
    expect((await store.progress("u")).get(c.patternId)).toEqual(before); // 진도 불변
  });
  it("훈련 시작 시도 뒤에도 챕터 학습 제출이 정상 동작한다", async () => {
    const { svc } = mk();
    await svc.open();
    await svc.startPractice("free"); // 학습 기록이 없어 실패해도 챕터 세션이 깨지면 안 된다
    svc.exitPractice();
    const c = svc.next()!;
    const s2 = (await content.sentences(c.patternId, ["original"])).find((x) => x.sentenceId === c.sentenceId)!;
    expect(await svc.submit(c.sentenceId, s2.en, false, 500)).toMatchObject({ kind: "graded", verdict: "PASS" });
  });
  it("자유 훈련은 아무것도 기록하지 않고 성적표를 낸다", async () => {
    const { svc, store } = mk();
    await svc.open();
    expect(await svc.startPractice("free", { n: 2 })).toMatchObject({ ok: true });
    let k = svc.next()!; expect(k.mode).toBe("free");
    const en = (await content.sentences(k.patternId, ["original"])).find((x) => x.sentenceId === k.sentenceId)!.en;
    await svc.submit(k.sentenceId, en, false, 1000);
    expect(await store.attempts("u")).toHaveLength(0); // 시도 기록 없음
    expect((await svc.notesView()).wrong).toHaveLength(0);
    k = svc.next()!; await svc.submit(k.sentenceId, "no no", false, 3000);
    expect(svc.next()).toBeUndefined();
    expect(svc.practiceSummary()).toMatchObject({ answered: 2, correct: 1, firstTryPct: 50, grade: "C", avgMs: 2000 });
  });
  it("완료 취소는 완료 노트에서 빼고 복습 일정을 지우며 챕터로 되돌린다", async () => {
    const { svc, store, clock } = mk();
    await svc.open();
    for (let c = svc.next(); c; c = svc.next()) {
      const s = (await content.sentences(c.patternId, ["original"])).find((x) => x.sentenceId === c.sentenceId)!;
      const r = await svc.submit(c.sentenceId, s.en, false, 1000);
      if (r.kind === "graded" && r.chapterCompleted) break;
    }
    const first = (await svc.notesView()).completed[0]!;
    expect((await store.dueReviews("u", clock.t + 86_400_000 + 1)).length).toBeGreaterThan(0);
    const r = await svc.uncomplete(first.patternId);
    expect(r.chapterId).toBeGreaterThan(0);
    expect((await svc.notesView()).completed.find((c) => c.patternId === first.patternId)).toBeUndefined();
    expect((await store.dueReviews("u", clock.t + 86_400_000 + 1))).not.toContain(first.patternId);
    expect((await store.progress("u")).get(first.patternId)).toMatchObject({ streak: 0, state: "learning" });
    expect((await svc.overview()).totalDone).toBeLessThan((await svc.overview()).totalPatterns);
  });
  it("필수 구문이 없어도 패턴 표현이 힌트가 된다", async () => {
    const c2: ContentRepository = { ...content, pattern: async (id) => ({ patternId: id, template: "be good at", level: "A1" }), sentences: async (p) => [{ ...sent(p, 1), mustUse: undefined }] };
    const svc = new StudyService({ userId: "h", content: c2, store: new SqliteUserStore(), grading: new GradingService(), rng: lcg(3), now: () => 0, tracks: ["original"] });
    await svc.open(); const card = svc.next()!;
    expect(card.hintAvailable).toBe(true);
    expect(svc.hint(card.sentenceId)).toBe("be good at");
  });
  it("제한 시간은 문장 길이로 정한다", () => {
    expect([timeLimitSec("a b c"), timeLimitSec("a b c d e f g h"), timeLimitSec("a b c d e f g h i j k l m")]).toEqual([15, 20, 30]);
  });
});
