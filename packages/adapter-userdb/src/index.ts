import { createRequire } from "node:module";
import type { DatabaseSync as DB } from "node:sqlite";
import type { AttemptGraded, AttemptRecord, UserStore } from "@app/contracts";
import type { PatternProgress } from "@app/domain";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/** 사용자 진도 저장소(SQLite). attempt 만 원시 기록이고 나머지는 파생 가능한 상태다. */
export class SqliteUserStore implements UserStore {
  private db: DB;
  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS user_pattern_state(user_id TEXT, pattern_id INTEGER, streak INTEGER, state TEXT, hint_only_streak INTEGER, consecutive_fails INTEGER, seen TEXT, last_seen INTEGER, PRIMARY KEY(user_id, pattern_id));
      CREATE TABLE IF NOT EXISTS attempt(attempt_id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, sentence_id INTEGER, pattern_id INTEGER, input_text TEXT, verdict TEXT, used_hint INTEGER, over_time INTEGER, grader_version TEXT, at INTEGER, elapsed_ms INTEGER DEFAULT 0);
      CREATE TABLE IF NOT EXISTS completion(user_id TEXT, pattern_id INTEGER, at INTEGER, undone_at INTEGER, PRIMARY KEY(user_id, pattern_id, at));
      CREATE TABLE IF NOT EXISTS srs_schedule(user_id TEXT, pattern_id INTEGER, box INTEGER, due_at INTEGER, PRIMARY KEY(user_id, pattern_id));
    `);
    const cols = (this.db.prepare("PRAGMA table_info(completion)").all() as any[]).map((c) => c.name);
    if (!cols.includes("undone_at")) this.db.exec("ALTER TABLE completion ADD COLUMN undone_at INTEGER");
  }

  async progress(userId: string): Promise<Map<number, PatternProgress>> {
    const rows = this.db.prepare("SELECT * FROM user_pattern_state WHERE user_id=?").all(userId) as any[];
    return new Map(rows.map((r) => [r.pattern_id, { patternId: r.pattern_id, streak: r.streak, state: r.state, hintOnlyStreak: r.hint_only_streak, consecutiveFails: r.consecutive_fails, seenSentenceIds: JSON.parse(r.seen), lastSeenAt: r.last_seen ?? undefined } as PatternProgress]));
  }
  async saveProgress(userId: string, p: PatternProgress): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO user_pattern_state VALUES (?,?,?,?,?,?,?,?)").run(userId, p.patternId, p.streak, p.state, p.hintOnlyStreak, p.consecutiveFails, JSON.stringify(p.seenSentenceIds), p.lastSeenAt ?? null);
  }
  async recordAttempt(userId: string, e: AttemptGraded): Promise<void> {
    this.db.prepare("INSERT INTO attempt(user_id,sentence_id,pattern_id,input_text,verdict,used_hint,over_time,grader_version,at,elapsed_ms) VALUES (?,?,?,?,?,?,?,?,?,?)").run(userId, e.sentenceId, e.patternId, e.input, e.verdict, e.usedHint ? 1 : 0, e.overTime ? 1 : 0, e.graderVersion, e.at ?? Date.now(), e.elapsedMs ?? 0);
  }
  async attempts(userId: string): Promise<AttemptRecord[]> {
    return (this.db.prepare("SELECT * FROM attempt WHERE user_id=? ORDER BY attempt_id").all(userId) as any[]).map((r) => ({ patternId: r.pattern_id, sentenceId: r.sentence_id, verdict: r.verdict, usedHint: !!r.used_hint, overTime: !!r.over_time, elapsedMs: r.elapsed_ms ?? 0, input: r.input_text, at: r.at }));
  }
  async recordCompletion(userId: string, patternId: number, at: number): Promise<void> {
    this.db.prepare("INSERT OR IGNORE INTO completion(user_id,pattern_id,at) VALUES (?,?,?)").run(userId, patternId, at);
  }
  async completions(userId: string): Promise<Array<{ patternId: number; at: number; undoneAt?: number }>> {
    return (this.db.prepare("SELECT pattern_id, at, undone_at FROM completion WHERE user_id=? ORDER BY at").all(userId) as any[]).map((r) => ({ patternId: r.pattern_id, at: r.at, undoneAt: r.undone_at ?? undefined }));
  }
  async markUndone(userId: string, patternId: number, at: number): Promise<void> {
    this.db.prepare("UPDATE completion SET undone_at=? WHERE user_id=? AND pattern_id=? AND undone_at IS NULL").run(at, userId, patternId);
  }
  async deleteSchedule(userId: string, patternId: number): Promise<void> {
    this.db.prepare("DELETE FROM srs_schedule WHERE user_id=? AND pattern_id=?").run(userId, patternId);
  }
  async dueReviews(userId: string, now: number): Promise<number[]> {
    return (this.db.prepare("SELECT pattern_id FROM srs_schedule WHERE user_id=? AND due_at<=? ORDER BY due_at").all(userId, now) as any[]).map((r) => r.pattern_id);
  }
  /** SRS 일정 저장(UserStore 포트 밖의 어댑터 보조 메서드: srs 모듈이 사용). */
  async saveSchedule(userId: string, patternId: number, box: number, dueAt: number): Promise<void> {
    this.db.prepare("INSERT OR REPLACE INTO srs_schedule VALUES (?,?,?,?)").run(userId, patternId, box, dueAt);
  }
  async scheduleOf(userId: string, patternId: number): Promise<{ box: number; dueAt: number } | undefined> {
    const r = this.db.prepare("SELECT box, due_at FROM srs_schedule WHERE user_id=? AND pattern_id=?").get(userId, patternId) as any;
    return r ? { box: r.box, dueAt: r.due_at } : undefined;
  }
}
