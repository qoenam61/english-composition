import type { AppEvent, ChapterRef, ContentRepository, SentenceRef, UserStore } from "@app/contracts";
import { GradingService, GRADER_VERSION } from "@app/grading";
import { Session } from "@app/session";
import { summarize } from "@app/stats";
import { emptyNotes, onAttemptGraded, onPatternCompleted, sortedWrong, type NotesState } from "@app/notes";
import { nextDue, type ChapterBoard, type PatternProgress } from "@app/domain";

export interface CardView {
  sentenceId: number; patternId: number; ko: string; context?: string; review: boolean;
  hintAvailable: boolean; timeLimitSec: number; patternNo: number; patternTemplate: string; level: string; board: ChapterBoard; chapterId: number; mode: "chapter" | PracticeKind;
}
export type PracticeKind = "weak" | "time";
export interface PracticeSummary { kind: PracticeKind; total: number; correct: number; avgMs: number; missedPatternIds: number[] }
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
  private practice?: { kind: PracticeKind; queue: Array<{ sentenceId: number; patternId: number }>; idx: number; answered: boolean; results: Array<{ patternId: number; ok: boolean; ms: number }> };
  private current?: { sentenceId: number; patternId: number; review: boolean };

  constructor(private d: StudyDeps) {}

  /** 아직 끝나지 않은 첫 챕터를 열어 이어하기 한다. */
  async open(chapterId?: number): Promise<ChapterBoard> {
    const all = await this.d.content.chapters();
    this.practice = undefined;
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

  /** 자유 훈련: 취약 패턴(오답노트) 또는 학습한 패턴을 n문제 연속. 패턴 진도·복습 일정은 바꾸지 않고, 시도 기록(노트·통계)만 남긴다. */
  async startPractice(kind: PracticeKind, n = 10): Promise<{ ok: true; total: number } | { ok: false; reason: string }> {
    if (!this.chapter) await this.open();
    await this.rebuildNotes(); // 진도 맵은 챕터 세션이 공유하므로 교체하지 않는다
    const pool = kind === "weak"
      ? sortedWrong(this.notes).map((w) => w.patternId)
      : [...this.progress.values()].filter((p) => p.seenSentenceIds.length > 0).map((p) => p.patternId);
    if (pool.length === 0) return { ok: false, reason: kind === "weak" ? "오답노트가 비어 있어요. 먼저 학습을 진행해 보세요." : "아직 학습한 패턴이 없어요." };
    const order = kind === "weak" ? pool.slice(0, n) : [...pool].sort(() => this.d.rng() - 0.5).slice(0, n);
    const bank = new Map<number, SentenceRef[]>();
    for (const pid of order) {
      const ss = await this.d.content.sentences(pid, this.d.tracks);
      bank.set(pid, ss); for (const x of ss) this.sentences.set(x.sentenceId, x);
      this.templates.set(pid, (await this.d.content.pattern(pid))?.template ?? "");
    }
    const queue: Array<{ sentenceId: number; patternId: number }> = []; const used = new Set<number>();
    for (let round = 0; round < n && queue.length < n; round++) {
      let added = false;
      for (const pid of order) {
        if (queue.length >= n) break;
        const free = (bank.get(pid) ?? []).filter((x) => !used.has(x.sentenceId));
        if (free.length === 0) continue;
        const pick = free[Math.floor(this.d.rng() * free.length)]!; used.add(pick.sentenceId); queue.push({ sentenceId: pick.sentenceId, patternId: pid }); added = true;
      }
      if (!added) break;
    }
    if (queue.length === 0) return { ok: false, reason: "출제할 문장이 없어요." };
    this.practice = { kind, queue, idx: -1, answered: true, results: [] };
    return { ok: true, total: queue.length };
  }

  practiceSummary(): PracticeSummary | undefined {
    const p = this.practice; if (!p) return undefined;
    const r = p.results;
    return { kind: p.kind, total: p.queue.length, correct: r.filter((x) => x.ok).length, avgMs: r.length ? Math.round(r.reduce((a, x) => a + x.ms, 0) / r.length) : 0, missedPatternIds: [...new Set(r.filter((x) => !x.ok).map((x) => x.patternId))] };
  }
  exitPractice(): void { this.practice = undefined; this.current = undefined; }

  private practiceBoard(): ChapterBoard {
    const p = this.practice!; const done = p.results.length;
    const badges = p.queue.map((_, i) => i < done);
    return { total: p.queue.length, done, remaining: p.queue.length - done, badges, complete: done >= p.queue.length };
  }

  private nextPractice(): CardView | undefined {
    const p = this.practice!;
    if (p.answered) { p.idx++; p.answered = false; }
    const q = p.queue[p.idx]; if (!q) { this.current = undefined; return undefined; }
    this.current = { sentenceId: q.sentenceId, patternId: q.patternId, review: false };
    const s = this.sentences.get(q.sentenceId)!;
    const base = timeLimitSec(s.en);
    return { sentenceId: s.sentenceId, patternId: s.patternId, ko: s.ko, context: s.context, review: false, hintAvailable: !!s.mustUse, timeLimitSec: p.kind === "time" ? Math.max(8, Math.round(base * 0.6)) : base, patternNo: p.idx + 1, patternTemplate: this.templates.get(s.patternId) ?? "", level: p.kind === "weak" ? "취약 패턴" : "타임어택", board: this.practiceBoard(), chapterId: 0, mode: p.kind };
  }

  private async submitPractice(sentenceId: number, input: string, usedHint: boolean, elapsedMs: number): Promise<SubmitView> {
    const p = this.practice!; const s = this.sentences.get(sentenceId)!;
    const r = await this.d.grading.grade(input, s.answers, s.context);
    if (r.verdict === "ERROR") return { kind: "error", message: "채점 오류 — 답안은 보관되었습니다. 다시 시도해 주세요." };
    const limit = timeLimitSec(s.en) * (p.kind === "time" ? 0.6 : 1) * 1000;
    const ev: AppEvent = { v: 1, type: "AttemptGraded", sentenceId, patternId: s.patternId, verdict: r.verdict, usedHint, overTime: elapsedMs > limit, input, graderVersion: GRADER_VERSION, elapsedMs, at: this.d.now() };
    this.d.bus?.(ev);
    await this.d.store.recordAttempt(this.d.userId, ev);
    this.notes = onAttemptGraded(this.notes, ev, this.d.now());
    if (r.verdict !== "MINOR_TYPO") { p.results.push({ patternId: s.patternId, ok: r.verdict === "PASS" && !usedHint, ms: elapsedMs }); p.answered = true; }
    return { kind: "graded", verdict: r.verdict, answer: s.answers[0] ?? s.en, patternCompleted: false, chapterCompleted: false, board: this.practiceBoard() };
  }

  next(): CardView | undefined {
    if (this.practice) return this.nextPractice();
    if (!this.session || !this.chapter) throw new Error("open() 먼저");
    const p = this.session.next(); if (!p) { this.current = undefined; return undefined; }
    this.current = p; const s = this.sentences.get(p.sentenceId)!;
    return { sentenceId: s.sentenceId, patternId: s.patternId, ko: s.ko, context: s.context, review: p.review, hintAvailable: !!s.mustUse, timeLimitSec: timeLimitSec(s.en), patternNo: this.chapter.patternIds.indexOf(s.patternId) + 1, patternTemplate: this.templates.get(s.patternId) ?? "", level: this.chapter.level, board: this.session.board(), chapterId: this.chapter.chapterId, mode: "chapter" };
  }

  hint(sentenceId: number): string | undefined { return this.sentences.get(sentenceId)?.mustUse; }

  notesView() { return { wrong: sortedWrong(this.notes), completed: [...this.notes.completed.values()] }; }

  async submit(sentenceId: number, input: string, usedHint: boolean, elapsedMs: number): Promise<SubmitView> {
    if (this.practice && this.current?.sentenceId === sentenceId) return this.submitPractice(sentenceId, input, usedHint, elapsedMs);
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
