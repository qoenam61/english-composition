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
  it("상황별 로드맵은 패턴 로드맵과 ID가 겹치지 않고 문장이 있다", async () => {
    const maps = await repo.roadmaps!();
    expect(maps[0]).toEqual({ id: "pattern", label: "패턴 학습 로드맵" }); expect(maps.length).toBe(10);
    const patternIds = new Set((await repo.chapters()).flatMap((c) => c.patternIds));
    let total = 250;
    for (const m of maps.slice(1)) {
      const cs = await repo.chapters(m.id); total += cs.length; expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) { expect(c.roadmap).toBe(m.id); for (const id of c.patternIds) expect(patternIds.has(id)).toBe(false); }
      const first = cs[0]!.patternIds[0]!; expect((await repo.sentences(first, ["original"])).length).toBe(1);
    }
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
