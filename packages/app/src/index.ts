import type { AppEvent, ChapterRef, ContentRepository, SentenceRef, UserStore } from "@app/contracts";
import { GradingService, GRADER_VERSION } from "@app/grading";
import { Session } from "@app/session";
import { summarize } from "@app/stats";
import { emptyNotes, onAttemptGraded, onPatternCompleted, sortedWrong, type NotesState } from "@app/notes";
import { nextDue, type ChapterBoard, type PatternProgress } from "@app/domain";

export interface CardView {
  sentenceId: number; patternId: number; ko: string; context?: string; review: boolean;
  hintAvailable: boolean; timeLimitSec: number; patternNo: number; patternTemplate: string; level: string; board: ChapterBoard; chapterId: number;
}
export type SubmitView =
  | { kind: "graded"; verdict: "PASS" | "MINOR_TYPO" | "FAIL"; answer: string; patternCompleted: boolean; chapterCompleted: boolean; board: ChapterBoard }
  | { kind: "error"; message: string };

/** 시간 제한: 영어 단어 6개 이하 15초 / 12개 이상 30초 / 그 사이 20초. */
export function timeLimitSec(en: string): number {
  const n = en.trim().split(/\s+/).length;
  return n <= 6 ? 15 : n >= 12 ? 30 : 20;
}

export interface StudyDeps {
  userId: string; content: ContentRepository; store: UserStore & { saveSchedule(u: string, p: number, box: number, due: number): Promise<void>; scheduleOf(u: string, p: number): Promise<{ box: number; dueAt: number } | undefined> };
  grading: GradingService; rng: () => number; now: () => number; tracks: ReadonlyArray<"original" | "own">; bus?: (e: AppEvent) => void;
}

/** 앱 서비스: 모듈들을 이벤트로 연결한다. UI는 이 클래스의 CardView/SubmitView 만 본다. */
export class StudyService {
  private notes: NotesState = emptyNotes();
  private session?: Session;
  private chapter?: ChapterRef;
  private sentences = new Map<number, SentenceRef>();
  private progress = new Map<number, PatternProgress>();
  private templates = new Map<number, string>();
  private current?: { sentenceId: number; patternId: number; review: boolean };

  constructor(private d: StudyDeps) {}

  /** 아직 끝나지 않은 첫 챕터를 열어 이어하기 한다. */
  async open(chapterId?: number): Promise<ChapterBoard> {
    const all = await this.d.content.chapters();
    this.progress = await this.d.store.progress(this.d.userId);
    const isDone = (c: ChapterRef) => c.patternIds.every((id) => this.progress.get(id)?.state === "done");
    this.chapter = (chapterId !== undefined ? all.find((c) => c.chapterId === chapterId) : all.find((c) => !isDone(c))) ?? all[all.length - 1]!;
    const byPattern = new Map<number, number[]>(); this.sentences.clear();
    this.templates.clear();
    for (const id of this.chapter.patternIds) {
      this.templates.set(id, (await this.d.content.pattern(id))?.template ?? "");
      const ss = await this.d.content.sentences(id, this.d.tracks);
      byPattern.set(id, ss.map((s) => s.sentenceId)); for (const s of ss) this.sentences.set(s.sentenceId, s);
    }
    await this.rebuildNotes();
    const due = await this.d.store.dueReviews(this.d.userId, this.d.now());
    this.session = new Session({ chapterId: this.chapter.chapterId, patternIds: this.chapter.patternIds, sentencesByPattern: byPattern, progress: this.progress, dueReviewPatternIds: due.filter((p) => byPattern.has(p)), rng: this.d.rng, emit: (e) => this.d.bus?.(e) });
    return this.session.board();
  }

  /** 노트는 파생 데이터: 시도 기록과 완료 기록을 시간순으로 재생해 복원한다. */
  private async rebuildNotes(): Promise<void> {
    const at = await this.d.store.attempts(this.d.userId); const done = await this.d.store.completions(this.d.userId);
    type Ev = { t: number; a?: (typeof at)[number]; c?: number };
    const evs: Ev[] = [...at.map((a): Ev => ({ t: a.at, a })), ...done.map((c): Ev => ({ t: c.at, c: c.patternId }))].sort((x, y) => x.t - y.t || (x.c !== undefined ? 1 : -1));
    let n = emptyNotes();
    for (const e of evs) {
      if (e.a) n = onAttemptGraded(n, { v: 1, type: "AttemptGraded", sentenceId: e.a.sentenceId, patternId: e.a.patternId, verdict: e.a.verdict, usedHint: e.a.usedHint, overTime: e.a.overTime, input: e.a.input, graderVersion: "replay" }, e.t);
      else n = onPatternCompleted(n, { v: 1, type: "PatternCompleted", patternId: e.c!, chapterId: 0 }, e.t);
    }
    this.notes = n;
  }

  async statsView() { return summarize(await this.d.store.attempts(this.d.userId), await this.d.store.completions(this.d.userId), this.d.now()); }

  next(): CardView | undefined {
    if (!this.session || !this.chapter) throw new Error("open() 먼저");
    const p = this.session.next(); if (!p) { this.current = undefined; return undefined; }
    this.current = p; const s = this.sentences.get(p.sentenceId)!;
    return { sentenceId: s.sentenceId, patternId: s.patternId, ko: s.ko, context: s.context, review: p.review, hintAvailable: !!s.mustUse, timeLimitSec: timeLimitSec(s.en), patternNo: this.chapter.patternIds.indexOf(s.patternId) + 1, patternTemplate: this.templates.get(s.patternId) ?? "", level: this.chapter.level, board: this.session.board(), chapterId: this.chapter.chapterId };
  }

  hint(sentenceId: number): string | undefined { return this.sentences.get(sentenceId)?.mustUse; }

  notesView() { return { wrong: sortedWrong(this.notes), completed: [...this.notes.completed.values()] }; }

  async submit(sentenceId: number, input: string, usedHint: boolean, elapsedMs: number): Promise<SubmitView> {
    if (!this.session || !this.current || this.current.sentenceId !== sentenceId) throw new Error("현재 문제가 아니다");
    const s = this.sentences.get(sentenceId)!;
    const r = await this.d.grading.grade(input, s.answers, s.context);
    if (r.verdict === "ERROR") return { kind: "error", message: "채점 오류 — 답안은 보관되었습니다. 다시 시도해 주세요." }; // 카운터 불변
    const overTime = elapsedMs > timeLimitSec(s.en) * 1000;
    const ev: AppEvent = { v: 1, type: "AttemptGraded", sentenceId, patternId: s.patternId, verdict: r.verdict, usedHint, overTime, input, graderVersion: GRADER_VERSION, elapsedMs, at: this.d.now() };
    this.d.bus?.(ev);
    await this.d.store.recordAttempt(this.d.userId, ev);
    this.notes = onAttemptGraded(this.notes, ev, this.d.now());
    const out = this.session.submit({ verdict: r.verdict, usedHint, overTime });
    await this.d.store.saveProgress(this.d.userId, this.progress.get(s.patternId)!);
    if (out.patternCompleted) {
      this.notes = onPatternCompleted(this.notes, { v: 1, type: "PatternCompleted", patternId: s.patternId, chapterId: this.chapter!.chapterId }, this.d.now());
      await this.d.store.recordCompletion(this.d.userId, s.patternId, this.d.now());
      await this.d.store.saveSchedule(this.d.userId, s.patternId, 0, nextDue(0, this.d.now()));
    }
    return { kind: "graded", verdict: r.verdict, answer: s.answers[0] ?? s.en, patternCompleted: out.patternCompleted, chapterCompleted: out.chapterCompleted, board: out.board };
  }
}
