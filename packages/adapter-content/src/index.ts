import { createRequire } from "node:module";
import type { DatabaseSync as DB } from "node:sqlite";
import type { ChapterRef, ContentRepository, PatternRef, RoadmapRef, SentenceRef } from "@app/contracts";

// vite 가 node:sqlite 접두사를 떼어 버리므로 require 로 불러온다
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** 콘텐츠 팩(SQLite)을 읽는 ContentRepository 구현체. 읽기 전용. */
export class SqliteContentRepository implements ContentRepository {
  private db: DB;
  private playable?: Set<number>; private cache = new Map<string, ChapterRef[]>();
  /** tracks 를 주면 그 트랙의 문장이 있는 패턴만 챕터에 남긴다(일반 사용자: own 만). 남은 패턴이 없는 챕터·로드맵은 사라진다. */
  constructor(path: string, private tracks?: ReadonlyArray<"original" | "own">) { this.db = new DatabaseSync(path, { readOnly: true } as object); this.hasRoadmap = this.detectRoadmap(); }
  private playableSet(): Set<number> | undefined {
    if (!this.tracks) return undefined;
    if (!this.playable) this.playable = new Set((this.db.prepare(`SELECT DISTINCT pattern_id AS p FROM sentence WHERE track IN (${this.tracks.map(() => "?").join(",") || "''"})`).all(...this.tracks) as Array<{ p: number }>).map((r) => r.p));
    return this.playable;
  }

  private hasRoadmap: boolean; // 구버전 팩(roadmap 컬럼 없음)도 읽는다
  private detectRoadmap(): boolean { try { return (this.db.prepare("SELECT COUNT(*) AS n FROM pragma_table_info('chapter') WHERE name='roadmap'").get() as { n: number }).n > 0; } catch { return false; }
  }

  async roadmaps(): Promise<RoadmapRef[]> {
    const all = !this.hasRoadmap ? [{ id: "pattern", label: "패턴 학습 로드맵" }] : (this.db.prepare("SELECT roadmap_id AS id, label FROM roadmap ORDER BY position").all() as unknown as RoadmapRef[]);
    if (!this.tracks) return all;
    const out: RoadmapRef[] = []; for (const r of all) if ((await this.chapters(r.id)).length) out.push(r); return out;
  }

  async chapters(roadmap = "pattern"): Promise<ChapterRef[]> {
    const hit = this.cache.get(roadmap); if (hit) return hit;
    const play = this.playableSet(); const list = await this.rawChapters(roadmap);
    const out = play ? list.map((c) => ({ ...c, patternIds: c.patternIds.filter((id) => play.has(id)) })).filter((c) => c.patternIds.length) : list;
    this.cache.set(roadmap, out); return out; // 팩은 실행 중 바뀌지 않는다
  }
  private async rawChapters(roadmap: string): Promise<ChapterRef[]> {
    const where = this.hasRoadmap && roadmap !== "*" ? "WHERE c.roadmap=?" : "";
    const sel = this.hasRoadmap ? "c.roadmap AS rm" : "'pattern' AS rm";
    const rows = this.db.prepare(`SELECT c.chapter_id AS id, c.level AS level, cp.pattern_id AS pid, ${sel} FROM chapter c JOIN chapter_pattern cp USING(chapter_id) ${where} ORDER BY c.chapter_id, cp.position`).all(...(where ? [roadmap] : [])) as unknown as Array<{ id: number; level: string; pid: number; rm: string }>;
    const out = new Map<number, ChapterRef>();
    for (const r of rows) {
      const c = out.get(r.id) ?? { chapterId: r.id, level: r.level, patternIds: [], roadmap: r.rm };
      c.patternIds.push(r.pid); out.set(r.id, c);
    }
    return [...out.values()];
  }

  async pattern(id: number): Promise<PatternRef | undefined> {
    const r = this.db.prepare("SELECT pattern_id AS patternId, template, level FROM pattern WHERE pattern_id=?").get(id) as PatternRef | undefined;
    return r;
  }

  async sentences(patternId: number, enabledTracks: ReadonlyArray<"original" | "own">): Promise<SentenceRef[]> {
    const rows = this.db.prepare("SELECT sentence_id AS sentenceId, pattern_id AS patternId, track, en, ko, context, must_use AS mustUse FROM sentence WHERE pattern_id=?").all(patternId) as Array<Omit<SentenceRef, "answers"> & { context: string | null; mustUse: string | null }>;
    const ans = this.db.prepare("SELECT answer_en FROM sentence_answer WHERE sentence_id=?");
    return rows.filter((r) => enabledTracks.includes(r.track)).map((r) => ({
      sentenceId: r.sentenceId, patternId: r.patternId, track: r.track, en: r.en, ko: r.ko,
      context: r.context ?? undefined, mustUse: r.mustUse ?? undefined,
      answers: (ans.all(r.sentenceId) as Array<{ answer_en: string }>).map((a) => a.answer_en),
    }));
  }
}
