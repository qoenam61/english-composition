import { describe, expect, it } from "vitest";
import { chapterStatuses, computeUserLevel, provenRank, rankOf, tierOf, type LevelChapter, type LevelRoadmap } from "../src/index.js";

let pid = 1;
const ch = (level: string, n = 2): LevelChapter => ({ chapterId: pid, level, patternIds: Array.from({ length: n }, () => pid++) });
const rm = (id: string, levels: string[], n = 2): LevelRoadmap => ({ id, chapters: levels.map((l) => ch(l, n)) });
const doneSet = () => {
  const s = new Set<number>();
  return { add: (cs: LevelChapter[]) => { for (const c of cs) for (const p of c.patternIds) s.add(p); }, has: (p: number) => s.has(p), set: s };
};

describe("레벨 순위", () => {
  it("A1=1 … C2=6, 3단계로 묶는다", () => {
    expect(rankOf("A1")).toBe(1); expect(rankOf("C2")).toBe(6); expect(rankOf("??")).toBe(0);
    expect([tierOf("A1"), tierOf("A2"), tierOf("B1"), tierOf("B2"), tierOf("C1"), tierOf("C2")]).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("입증 레벨(provenRank)", () => {
  it("U 위에서 연속으로 끝낸 가장 높은 레벨", () => {
    const r = rm("a", ["A1", "A1", "A2", "B1", "B1", "B2"]); const d = doneSet(); d.add(r.chapters.slice(0, 4));
    expect(provenRank(r.chapters, d.has, 0)).toBe(rankOf("A2")); // A1·A2 완료, B1은 한 챕터만 끝나 미완
    d.add(r.chapters.slice(4, 5)); expect(provenRank(r.chapters, d.has, 0)).toBe(rankOf("B1"));
  });
  it("레벨 사이에 빈 단계가 있으면 건너뛰지 않는다(면접: B1, C2만)", () => {
    const r = rm("i", ["B1", "C2"]); const d = doneSet(); d.add(r.chapters.slice(0, 1));
    expect(provenRank(r.chapters, d.has, 0)).toBe(rankOf("B1")); // C1이 아니다
  });
});

describe("사용자 레벨 · 해금 (요구 시나리오)", () => {
  it("패턴에서 B1까지 끝내면 다른 카테고리의 B1 이하가 모두 열린다", () => {
    const pattern = rm("pattern", ["A1", "A2", "B1", "B2", "C1"], 30); const hospital = rm("hospital", ["A1", "A2", "B1", "B2", "C1"], 30);
    const d = doneSet(); d.add(pattern.chapters.slice(0, 3));
    const u = computeUserLevel([pattern, hospital], d.has, 0); expect(u).toBe(rankOf("B1"));
    const st = chapterStatuses(hospital.chapters, d.has, u);
    expect(st).toEqual(["open", "open", "current", "open", "locked"]); // B1 이하 열림, 다음 단계(B2)의 첫 챕터만 frontier로 열림, C1은 잠김
  });
  it("병원에서 입문을 건너뛰고 B2까지만 끝내도 레벨이 B2로 오른다(건너뛴 챕터가 레벨 상승을 막지 않는다)", () => {
    const pattern = rm("pattern", ["A1", "A2", "B1", "B2", "C1"], 30); const hospital = rm("hospital", ["A1", "A2", "B1", "B2", "C1"], 30);
    const d = doneSet(); d.add(pattern.chapters.slice(0, 3)); // U = B1
    let u = computeUserLevel([pattern, hospital], d.has, 0); expect(u).toBe(rankOf("B1"));
    d.add(hospital.chapters.slice(2, 4)); // 병원 B1·B2만 완료(A1·A2는 건너뜀)
    u = computeUserLevel([pattern, hospital], d.has, u); expect(u).toBe(rankOf("B2"));
    const pst = chapterStatuses(pattern.chapters, d.has, u); // 패턴의 B2도 열린다
    expect(pst[3]).not.toBe("locked");
    const hst = chapterStatuses(hospital.chapters, d.has, u); // 병원: A1·A2 열림(미완), C1이 frontier(current)
    expect(hst.slice(0, 2)).toEqual(["open", "open"]); expect(hst[4]).toBe("current");
  });
  it("current 는 레벨 이상의 첫 미완료 챕터이고 항상 열려 있다(고레벨 사용자를 A1로 끌어내리지 않는다)", () => {
    const r = rm("x", ["A1", "A2", "B1", "B2", "C1"]); const d = doneSet();
    const st = chapterStatuses(r.chapters, d.has, rankOf("B1"));
    expect(st).toEqual(["open", "open", "current", "open", "locked"]);
    expect(st.indexOf("current")).toBeGreaterThanOrEqual(0);
  });
  it("신규 사용자(레벨 0)는 처음 미완료 이후가 잠긴다(기존 동작)", () => {
    const r = rm("n", ["A1", "A2", "B1"]); const d = doneSet(); d.add(r.chapters.slice(0, 1));
    expect(chapterStatuses(r.chapters, d.has, 0)).toEqual(["done", "current", "locked"]);
  });
  it("저장된 최고 레벨은 완료를 취소해도 내려가지 않는다", () => {
    const r = rm("pattern", ["A1", "A2", "B1"], 60); const d = doneSet(); d.add(r.chapters);
    const u = computeUserLevel([r], d.has, 0); expect(u).toBe(rankOf("B1"));
    d.set.clear(); // 완료 취소·문장 추가로 모두 미완료가 된 상황
    expect(computeUserLevel([r], d.has, u)).toBe(u);
  });
  it("작은 로드맵(패턴 100개 미만)은 레벨에 기여하지 못한다", () => {
    const small = rm("interview", ["B1", "C2"], 20); const d = doneSet(); d.add(small.chapters);
    expect(computeUserLevel([small], d.has, 0)).toBe(0);
  });
  it("모든 상태에서 current는 잠기지 않는다(무작위 점검)", () => {
    let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 200; k++) {
      const levels = ["A1", "A2", "B1", "B2", "C1", "C2"].filter(() => rnd() < 0.8).flatMap((l) => (rnd() < 0.5 ? [l, l] : [l]));
      const r = rm("r" + k, levels); const d = doneSet(); r.chapters.forEach((c) => { if (rnd() < 0.4) d.add([c]); });
      const u = Math.floor(rnd() * 7); const st = chapterStatuses(r.chapters, d.has, u);
      const undone = r.chapters.filter((c) => !c.patternIds.every(d.has)).length;
      if (undone) { expect(st.filter((s) => s === "current").length).toBe(1); } else expect(st.every((s) => s === "done")).toBe(true);
      st.forEach((s, i) => { if (s === "current" || s === "open") expect(s).not.toBe("locked"); expect(r.chapters.length).toBeGreaterThan(i); });
    }
  });
});
