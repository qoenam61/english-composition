import { describe, expect, it } from "vitest";
import type { ChapterRef, ContentRepository, SentenceRef } from "@app/contracts";
import type { PatternProgress } from "@app/domain";
import { GradingService } from "@app/grading";
import { SqliteUserStore } from "@app/adapter-userdb";
import { ChapterLockedError, StudyService } from "../src/index.js";

// 패턴 로드맵 160개(A1 1–40, A2 41–80, B1 81–120, B2 121–160)와 병원 로드맵: 입문 2챕터는 병원 전용(1001–), B1·B2는 패턴과 같은 id를 공유, C1은 잠김 확인용.
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const P: ChapterRef[] = [[1, 1, 40, "A1"], [2, 41, 80, "A2"], [3, 81, 120, "B1"], [4, 121, 160, "B2"]].map(([id, , , lv], i) => ({ chapterId: id as number, level: lv as string, patternIds: range([1, 41, 81, 121][i]!, [40, 80, 120, 160][i]!), roadmap: "pattern" }));
const H: ChapterRef[] = [
  { chapterId: 11, level: "A1", patternIds: range(1001, 1040), roadmap: "hospital" }, { chapterId: 12, level: "A2", patternIds: range(1041, 1080), roadmap: "hospital" },
  { chapterId: 13, level: "B1", patternIds: range(81, 120), roadmap: "hospital" }, { chapterId: 14, level: "B2", patternIds: range(121, 160), roadmap: "hospital" },
  { chapterId: 15, level: "C1", patternIds: range(1161, 1200), roadmap: "hospital" },
];
const content: ContentRepository = {
  chapters: async (rm = "pattern") => (rm === "*" ? [...P, ...H] : rm === "hospital" ? H : P),
  roadmaps: async () => [{ id: "pattern", label: "패턴" }, { id: "hospital", label: "병원" }],
  pattern: async () => undefined,
  sentences: async (p) => [{ sentenceId: p * 10, patternId: p, track: "original", en: "x", ko: "x", answers: ["x"] } as SentenceRef],
};
const done = (id: number): PatternProgress => ({ patternId: id, streak: 2, state: "done", hintOnlyStreak: 0, consecutiveFails: 0, seenSentenceIds: [] });
const undone = (id: number): PatternProgress => ({ ...done(id), streak: 0, state: "learning" });
const mk = () => { const store = new SqliteUserStore(); return { store, svc: new StudyService({ userId: "u", content, store, grading: new GradingService(), rng: Math.random, now: () => 1_000_000, tracks: ["original"] }) }; };
const finish = async (store: SqliteUserStore, ids: number[]) => { for (const id of ids) await store.saveProgress("u", done(id)); };
const stat = async (svc: StudyService, rm: string) => (await svc.overview(rm)).chapters.map((c) => c.status);

describe("레벨 해금 · 교차 완료 (StudyService)", () => {
  it("신규 사용자: 기존처럼 처음 미완료 이후가 잠긴다", async () => {
    const { svc } = mk();
    expect(await stat(svc, "pattern")).toEqual(["current", "locked", "locked", "locked"]);
    expect((await svc.overview("pattern")).userLevel).toBeNull();
  });
  it("패턴 로드맵에서 B1까지 끝내면 병원의 입문·B1이 열리고, 같은 패턴을 공유한 B1 챕터는 이미 완료다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    const ov = await svc.overview("hospital");
    expect(ov.userLevel).toBe("B1");
    expect(ov.chapters.map((c) => c.status)).toEqual(["open", "open", "done", "current", "locked"]); // 병원 B1은 패턴에서 끝낸 것과 같아 완료 / B2가 다음 단계(current) / C1 잠김
    expect(await stat(svc, "pattern")).toEqual(["done", "done", "done", "current"]);
  });
  it("병원에서 입문을 건너뛰고 B2까지만 끝내도 패턴 로드맵의 B2가 열린다(건너뛴 챕터가 상승을 막지 않는다)", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120)); await svc.overview("hospital");
    await finish(store, range(121, 160)); // 병원의 B2(= 패턴 B2와 같은 패턴) 완료
    const ov = await svc.overview("hospital"); expect(ov.userLevel).toBe("B2");
    expect(ov.chapters.map((c) => c.status)).toEqual(["open", "open", "done", "done", "current"]);
  });
  it("잠긴 챕터는 열 수 없고(ChapterLockedError), 열린 챕터는 열린다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    await expect(svc.open(15)).rejects.toBeInstanceOf(ChapterLockedError); // 병원 C1
    await expect(svc.open(11)).resolves.toBeTruthy(); // 병원 A1(레벨 B1 이하라 열림)
    await expect(svc.open(14)).resolves.toBeTruthy(); // 병원 B2(다음 단계 첫 챕터)
  });
  it("이어하기는 레벨 이상의 첫 미완료 챕터로 가고, 고레벨 사용자를 A1로 끌어내리지 않는다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    await svc.open(undefined, "hospital"); expect((await svc.overview("hospital")).activeChapterId).toBe(14);
  });
  it("인자 없는 open()(다음 챕터)은 지금 공부하던 로드맵에 머문다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    await svc.open(14); await svc.open(); expect((await svc.overview("hospital")).activeChapterId).toBe(14); // 병원 B2(미완료)에서 패턴 로드맵으로 튀지 않는다
    expect((await svc.overview("pattern")).activeChapterId).toBe(14);
  });
  it("완료를 취소해도 사용자 레벨은 내려가지 않는다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120)); await svc.overview("pattern");
    for (const id of range(1, 160)) await store.saveProgress("u", undone(id));
    expect((await svc.overview("pattern")).userLevel).toBe("B1");
    expect((await stat(svc, "pattern"))[2]).not.toBe("locked"); // B1 이하는 계속 열려 있다
  });
  it("overviewAll: 로드맵별·단계별 진행과 현재 단계", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    const all = await svc.overviewAll(); const h = all.roadmaps.find((r) => r.id === "hospital")!;
    expect(all.userLevel).toBe("B1"); expect(h.tiers.map((t) => t.total)).toEqual([2, 2, 1]);
    expect(h.tiers[1]).toEqual({ total: 2, done: 1, open: 2 }); expect(h.currentTier).toBe(1);
    expect((await svc.overviewAll((id) => id === "pattern")).roadmaps.map((r) => r.id)).toEqual(["pattern"]);
  });
  it("완료 취소는 같은 패턴이 두 로드맵에 있어도 요청한 로드맵의 챕터를 연다", async () => {
    const { svc, store } = mk(); await finish(store, range(1, 120));
    expect((await svc.uncomplete(90)).chapterId).toBe(3); expect((await svc.uncomplete(90, "hospital")).chapterId).toBe(13);
  });
});
