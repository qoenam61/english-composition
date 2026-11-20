import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { PatternProgress } from "@app/domain";
import { Session } from "@app/session";
import { GradingService } from "@app/grading";
import { SqliteContentRepository } from "../src/index.js";

const PACK = new URL("../../../dist/pack-personal.sqlite", import.meta.url).pathname;
// 팩은 git 에 없으므로(원본 포함) 로컬에 빌드된 경우에만 실행한다.
describe.skipIf(!existsSync(PACK))("pack-personal 통합", () => {
  const repo = existsSync(PACK) ? new SqliteContentRepository(PACK) : (undefined as never);
  it("챕터 구성이 레벨별 정원 이하이고 모든 패턴에 문장이 있다", async () => {
    const chapters = await repo.chapters();
    expect(chapters.length).toBe(250);
    const cap: Record<string, number> = { A1: 30, A2: 30, B1: 25, B2: 20, C1: 15, C2: 10 };
    for (const c of chapters.slice(0, 20)) {
      expect(c.patternIds.length).toBeLessThanOrEqual(cap[c.level]!);
      for (const id of c.patternIds) expect((await repo.sentences(id, ["original", "own"])).length).toBeGreaterThan(0);
    }
  });
  it("장소 로드맵 = 어휘 문장(새 id) + 패턴 로드맵의 패턴(같은 id 공유). 패턴은 장소 한 곳에만, 챕터는 40개 이하", async () => {
    const maps = await repo.roadmaps!();
    expect(maps[0]).toEqual({ id: "pattern", label: "패턴 학습 로드맵" }); expect(maps.length).toBe(10);
    const patternIds = new Set((await repo.chapters()).flatMap((c) => c.patternIds));
    const placed = new Map<number, string>(); let total = 250;
    for (const m of maps.slice(1)) {
      const cs = await repo.chapters(m.id); total += cs.length; expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect(c.roadmap).toBe(m.id); expect(c.patternIds.length).toBeLessThanOrEqual(40);
        for (const id of c.patternIds) { expect(placed.has(id)).toBe(false); placed.set(id, m.id); if (!patternIds.has(id)) expect(id).toBeGreaterThanOrEqual(100000); }
      }
      const first = cs[0]!.patternIds[0]!; expect((await repo.sentences(first, ["original"])).length).toBeGreaterThanOrEqual(1);
    }
    for (const id of patternIds) expect(placed.has(id)).toBe(true); // 패턴 로드맵의 모든 패턴이 장소 한 곳에도 들어 있다
    expect((await repo.chapters("*")).length).toBe(total);
  });
  it("첫 챕터를 정답 입력으로 끝까지 완주한다(실데이터)", async () => {
    const ch = (await repo.chapters())[0]!;
    const sentences = new Map<number, number[]>(); const answers = new Map<number, string[]>();
    for (const id of ch.patternIds) {
      const ss = await repo.sentences(id, ["original"]); sentences.set(id, ss.map((s) => s.sentenceId));
      for (const s of ss) answers.set(s.sentenceId, s.answers);
    }
    let seed = 5; const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const s = new Session({ chapterId: ch.chapterId, patternIds: ch.patternIds, sentencesByPattern: sentences, progress: new Map<number, PatternProgress>(), rng });
    const g = new GradingService(); let n = 0;
    for (let p = s.next(); p && n < 500; p = s.next(), n++) {
      const r = await g.grade(answers.get(p.sentenceId)![0]!, answers.get(p.sentenceId)!);
      const out = s.submit({ verdict: r.verdict === "ERROR" ? "FAIL" : r.verdict, usedHint: false, overTime: false });
      if (out.chapterCompleted) break;
    }
    expect(s.board().complete).toBe(true);
    expect(n + 1).toBe(ch.patternIds.length * 2);
  });
});

// 일반 사용자 시점: own 문장이 팩에 반영된 뒤에만 의미가 있다(반영 전이면 건너뜀).
describe.skipIf(!existsSync(PACK))("pack-personal 일반 사용자(own 전용)", () => {
  const pub = existsSync(PACK) ? new SqliteContentRepository(PACK, ["own"]) : (undefined as never);
  it("보이는 모든 패턴에 own 문장이 있고, 원본 문장은 나오지 않는다", async () => {
    const chs = await pub.chapters("*"); if (!chs.length) return;
    for (const c of chs.filter((_, i) => i % 23 === 0)) for (const id of c.patternIds) {
      const ss = await pub.sentences(id, ["own"]); expect(ss.length).toBeGreaterThan(0); expect(ss.every((x) => x.track === "own")).toBe(true);
      expect((await pub.sentences(id, ["original"])).length).toBeGreaterThanOrEqual(0);
    }
    expect((await pub.roadmaps!()).map((r) => r.id)).toContain("pattern");
  });
  it("첫 챕터를 own 정답 입력으로 끝까지 완주한다", async () => {
    const ch = (await pub.chapters())[0]; if (!ch) return;
    const sentences = new Map<number, number[]>(); const answers = new Map<number, string[]>();
    for (const id of ch.patternIds) { const ss = await pub.sentences(id, ["own"]); sentences.set(id, ss.map((s) => s.sentenceId)); for (const s of ss) answers.set(s.sentenceId, s.answers); }
    let seed = 9; const rng = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
    const s = new Session({ chapterId: ch.chapterId, patternIds: ch.patternIds, sentencesByPattern: sentences, progress: new Map<number, PatternProgress>(), rng });
    const g = new GradingService(); let n = 0;
    for (let p = s.next(); p && n < 800; p = s.next(), n++) {
      const r = await g.grade(answers.get(p.sentenceId)![0]!, answers.get(p.sentenceId)!);
      if (s.submit({ verdict: r.verdict === "ERROR" ? "FAIL" : r.verdict, usedHint: false, overTime: false }).chapterCompleted) break;
    }
    expect(s.board().complete).toBe(true);
  });
});
