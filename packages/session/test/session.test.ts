import { describe, expect, it } from "vitest";
import type { PatternProgress } from "@app/domain";
import type { AppEvent } from "@app/contracts";
import { Session } from "../src/index.js";

function lcg(seed: number) { let s = seed; return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const ids = Array.from({ length: 10 }, (_, i) => i + 1);
const make = (seed: number, events: AppEvent[]) => new Session({
  chapterId: 1, patternIds: ids, progress: new Map<number, PatternProgress>(),
  sentencesByPattern: new Map(ids.map((id) => [id, [id * 10, id * 10 + 1]])), rng: lcg(seed), emit: (e) => events.push(e),
});

describe("챕터 완주 시뮬레이션 (화면 없음)", () => {
  it("전부 정답이면 패턴당 2문제, 총 20문제로 챕터가 끝난다", () => {
    const ev: AppEvent[] = []; const s = make(1, ev); let n = 0; let last;
    for (let p = s.next(); p; p = s.next()) { last = s.submit({ verdict: "PASS", usedHint: false, overTime: false }); n++; if (last.chapterCompleted) break; }
    expect(n).toBe(20);
    expect(s.board()).toMatchObject({ done: 10, remaining: 0, complete: true });
    expect(ev.filter((e) => e.type === "PatternCompleted")).toHaveLength(10);
    expect(ev.at(-1)?.type).toBe("ChapterCompleted");
  });
  it("틀림과 힌트가 섞여도 완료된 패턴은 다시 나오지 않고 결국 끝난다", () => {
    const ev: AppEvent[] = []; const s = make(7, ev); const doneAt = new Map<number, number>(); const r = lcg(99); let n = 0;
    while (n < 2000) {
      const p = s.next(); if (!p) break;
      expect(doneAt.has(p.patternId)).toBe(false); // 도장깨기: 완료 패턴 재출제 없음
      const x = r();
      const res = s.submit({ verdict: x < 0.25 ? "FAIL" : "PASS", usedHint: x > 0.9, overTime: false });
      if (res.patternCompleted) doneAt.set(p.patternId, n);
      n++;
      if (res.chapterCompleted) break;
    }
    expect(s.board().complete).toBe(true);
  });
  it("직전과 같은 패턴을 연속으로 내지 않는다", () => {
    const s = make(3, []); let prev = -1;
    for (let i = 0; i < 12; i++) { const p = s.next()!; expect(p.patternId).not.toBe(prev); prev = p.patternId; s.submit({ verdict: "FAIL", usedHint: false, overTime: false }); }
  });
});
