import { createRequire } from "node:module";
import type { DatabaseSync as DB } from "node:sqlite";
import type { ChapterRef, ContentRepository, PatternRef, SentenceRef } from "@app/contracts";

// vite 가 node:sqlite 접두사를 떼어 버리므로 require 로 불러온다
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** 콘텐츠 팩(SQLite)을 읽는 ContentRepository 구현체. 읽기 전용. */
export class SqliteContentRepository implements ContentRepository {
  private db: DB;
  constructor(path: string) { this.db = new DatabaseSync(path, { readOnly: true } as object); }

  async chapters(): Promise<ChapterRef[]> {
    const rows = this.db.prepare("SELECT c.chapter_id AS id, c.level AS level, cp.pattern_id AS pid FROM chapter c JOIN chapter_pattern cp USING(chapter_id) ORDER BY c.chapter_id, cp.position").all() as Array<{ id: number; level: string; pid: number }>;
    const out = new Map<number, ChapterRef>();
    for (const r of rows) {
      const c = out.get(r.id) ?? { chapterId: r.id, level: r.level, patternIds: [] };
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
