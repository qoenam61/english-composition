import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SqliteContentRepository } from "../src/index.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

// 패턴 1·2는 원본+own 문장, 패턴 3은 원본만. 병원 로드맵: 챕터 11 = [1, 3], 챕터 12 = [3](own 없음 → 일반 사용자에겐 사라진다).
function pack() {
  const path = join(mkdtempSync(join(tmpdir(), "pack-")), "p.sqlite"); const d = new DatabaseSync(path);
  d.exec(`CREATE TABLE pattern(pattern_id INTEGER PRIMARY KEY, template TEXT, level TEXT);
    CREATE TABLE sentence(sentence_id INTEGER PRIMARY KEY, pattern_id INTEGER, track TEXT, en TEXT, ko TEXT, context TEXT, must_use TEXT, difficulty TEXT, source_ref TEXT);
    CREATE TABLE sentence_answer(sentence_id INTEGER, answer_en TEXT, kind TEXT, rule_version INTEGER);
    CREATE TABLE chapter(chapter_id INTEGER PRIMARY KEY, level TEXT, n_patterns INTEGER, roadmap TEXT NOT NULL DEFAULT 'pattern');
    CREATE TABLE roadmap(roadmap_id TEXT PRIMARY KEY, label TEXT, position INTEGER);
    CREATE TABLE chapter_pattern(chapter_id INTEGER, position INTEGER, pattern_id INTEGER);
    INSERT INTO roadmap VALUES ('pattern','패턴',0),('hospital','병원',1),('travel','여행',2);
    INSERT INTO pattern VALUES (1,'a','A1'),(2,'b','A1'),(3,'c','A2');
    INSERT INTO sentence VALUES (10,1,'original','x','x',NULL,NULL,'A1',NULL),(11,1,'own','y','y',NULL,NULL,'A1',NULL),(20,2,'original','x','x',NULL,NULL,'A1',NULL),(21,2,'own','y','y',NULL,NULL,'A1',NULL),(30,3,'original','x','x',NULL,NULL,'A2',NULL);
    INSERT INTO chapter VALUES (1,'A1',2,'pattern'),(11,'A2',2,'hospital'),(12,'A2',1,'hospital'),(21,'A2',1,'travel');
    INSERT INTO chapter_pattern VALUES (1,1,1),(1,2,2),(11,1,1),(11,2,3),(12,1,3),(21,1,3);`);
  d.close(); return path;
}

describe("트랙별 콘텐츠(일반 사용자는 own 문장이 있는 패턴만)", () => {
  const path = pack();
  it("관리자(트랙 제한 없음)는 전부 본다", async () => {
    const all = new SqliteContentRepository(path);
    expect((await all.chapters("hospital")).map((c) => c.patternIds)).toEqual([[1, 3], [3]]);
    expect((await all.roadmaps!()).map((r) => r.id)).toEqual(["pattern", "hospital", "travel"]);
  });
  it("own 전용은 own 문장이 없는 패턴·빈 챕터·빈 로드맵을 뺀다", async () => {
    const pub = new SqliteContentRepository(path, ["own"]);
    expect((await pub.chapters("hospital")).map((c) => [c.chapterId, c.patternIds])).toEqual([[11, [1]]]);
    expect(await pub.chapters("travel")).toEqual([]);
    expect((await pub.roadmaps!()).map((r) => r.id)).toEqual(["pattern", "hospital"]);
    expect((await pub.chapters("*")).map((c) => c.chapterId)).toEqual([1, 11]);
  });
});
