import type { AppEvent, ChapterRef, ContentRepository, SentenceRef, UserStore } from "@app/contracts";
import { GradingService, GRADER_VERSION } from "@app/grading";
import { Session } from "@app/session";
import { summarize } from "@app/stats";
import { classifyError, emptyNotes, onAttemptGraded, onPatternCompleted, onPatternUncompleted, sortedWrong, type NotesState } from "@app/notes";
import { nextDue, type ChapterBoard, type PatternProgress } from "@app/domain";

export interface CardView {
  sentenceId: number; patternId: number; ko: string; context?: string; review: boolean;
  hintAvailable: boolean; timeLimitSec: number; patternNo: number; patternTemplate: string; level: string; board: ChapterBoard; chapterId: number; mode: "chapter" | PracticeKind;
}
export type PracticeKind = "weak" | "free";
export interface PracticeSummary { kind: PracticeKind; total: number; answered: number; correct: number; avgMs: number; firstTryPct: number; grade: "S" | "A" | "B" | "C"; missedPatternIds: number[]; patterns: string[] }
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
  private practice?: { kind: PracticeKind; level: string; queue: Array<{ sentenceId: number; patternId: number }>; idx: number; answered: boolean; results: Array<{ patternId: number; ok: boolean; ms: number }> };
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
    const rank = (e: { a?: unknown; c?: number; u?: number }) => (e.a ? 0 : e.c !== undefined ? 1 : 2);
    type Ev = { t: number; a?: (typeof at)[number]; c?: number; u?: number };
    const evs: Ev[] = [...at.map((a): Ev => ({ t: a.at, a })), ...done.map((c): Ev => ({ t: c.at, c: c.patternId })), ...done.filter((c) => c.undoneAt !== undefined).map((c): Ev => ({ t: c.undoneAt!, u: c.patternId }))].sort((x, y) => x.t - y.t || rank(x) - rank(y)); // 같은 시각이면 시도 → 완료 → 완료취소 순
    let n = emptyNotes();
    for (const e of evs) {
      if (e.a) n = onAttemptGraded(n, { v: 1, type: "AttemptGraded", sentenceId: e.a.sentenceId, patternId: e.a.patternId, verdict: e.a.verdict, usedHint: e.a.usedHint, overTime: e.a.overTime, input: e.a.input, graderVersion: "replay" }, e.t);
      else if (e.u !== undefined) n = onPatternUncompleted(n, e.u);
      else n = onPatternCompleted(n, { v: 1, type: "PatternCompleted", patternId: e.c!, chapterId: 0 }, e.t);
    }
    this.notes = n;
  }

  async statsView() { return summarize(await this.d.store.attempts(this.d.userId), await this.d.store.completions(this.d.userId), this.d.now()); }


  private async sentencesOf(pid: number): Promise<SentenceRef[]> {
    const ss = await this.d.content.sentences(pid, this.d.tracks);
    for (const x of ss) this.sentences.set(x.sentenceId, x);
    if (!this.templates.has(pid)) this.templates.set(pid, (await this.d.content.pattern(pid))?.template ?? "");
    return ss;
  }

  /** 연습 시작. weak = 오답 패턴 집중(시도 기록·노트에 반영), free = 자유 훈련(아무것도 기록하지 않는 샌드박스, 난이도 필터). */
  async startPractice(kind: PracticeKind, opts: { n?: number; level?: string; patternIds?: number[]; sentenceId?: number } = {}): Promise<{ ok: true; total: number } | { ok: false; reason: string }> {
    if (!this.chapter) await this.open();
    await this.rebuildNotes(); // 진도 맵은 챕터 세션이 공유하므로 교체하지 않는다
    const n = opts.n ?? (kind === "weak" ? 5 : 10);
    let order: number[];
    if (opts.patternIds) order = opts.patternIds;
    else if (kind === "weak") order = sortedWrong(this.notes).map((w) => w.patternId).slice(0, n);
    else {
      const all = await this.d.content.chapters();
      const pool = all.filter((c) => !opts.level || opts.level === "all" || c.level === opts.level).flatMap((c) => c.patternIds);
      const fresh = await this.d.store.progress(this.d.userId);
      const seen = pool.filter((id) => (fresh.get(id)?.seenSentenceIds.length ?? 0) > 0);
      const rest = pool.filter((id) => !seen.includes(id));
      const shuffle = <T,>(a: T[]) => [...a].sort(() => this.d.rng() - 0.5);
      order = [...shuffle(seen), ...shuffle(rest)].slice(0, n);
    }
    if (order.length === 0) return { ok: false, reason: kind === "weak" ? "오답노트가 비어 있어요. 먼저 학습을 진행해 보세요." : "해당 난이도의 문제가 없어요." };
    const bank = new Map<number, SentenceRef[]>();
    for (const pid of order) bank.set(pid, await this.sentencesOf(pid));
    const queue: Array<{ sentenceId: number; patternId: number }> = []; const used = new Set<number>();
    if (opts.sentenceId !== undefined && this.sentences.get(opts.sentenceId)) { used.add(opts.sentenceId); queue.push({ sentenceId: opts.sentenceId, patternId: this.sentences.get(opts.sentenceId)!.patternId }); }
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
    this.practice = { kind, level: opts.level ?? "all", queue, idx: -1, answered: true, results: [] };
    return { ok: true, total: queue.length };
  }

  /** 성적표. 등급은 힌트 없이 한 번에 맞힌 비율 기준: S 90% 이상 / A 75% / B 60% / 그 아래 C. */
  practiceSummary(): PracticeSummary | undefined {
    const p = this.practice; if (!p) return undefined;
    const r = p.results; const ok = r.filter((x) => x.ok).length; const pct = r.length ? Math.round((ok / r.length) * 100) : 0;
    return {
      kind: p.kind, total: p.queue.length, answered: r.length, correct: ok, avgMs: r.length ? Math.round(r.reduce((a, x) => a + x.ms, 0) / r.length) : 0,
      firstTryPct: pct, grade: pct >= 90 ? "S" : pct >= 75 ? "A" : pct >= 60 ? "B" : "C",
      missedPatternIds: [...new Set(r.filter((x) => !x.ok).map((x) => x.patternId))],
      patterns: [...new Set(r.map((x) => this.templates.get(x.patternId) ?? ""))].filter(Boolean).slice(0, 8),
    };
  }
  exitPractice(): void { this.practice = undefined; this.current = undefined; }

  private practiceBoard(): ChapterBoard {
    const p = this.practice!; const done = p.results.length;
    return { total: p.queue.length, done, remaining: p.queue.length - done, badges: p.queue.map((_, i) => i < done), complete: done >= p.queue.length };
  }

  private nextPractice(): CardView | undefined {
    const p = this.practice!;
    if (p.answered) { p.idx++; p.answered = false; }
    const q = p.queue[p.idx]; if (!q) { this.current = undefined; return undefined; }
    this.current = { sentenceId: q.sentenceId, patternId: q.patternId, review: false };
    const s = this.sentences.get(q.sentenceId)!;
    return { sentenceId: s.sentenceId, patternId: s.patternId, ko: s.ko, context: s.context, review: false, hintAvailable: !!(s.mustUse || this.templates.get(s.patternId)), timeLimitSec: timeLimitSec(s.en), patternNo: p.idx + 1, patternTemplate: this.templates.get(s.patternId) ?? "", level: p.kind === "weak" ? "집중 공략" : p.level === "all" ? "자유 훈련" : `자유 훈련 · ${p.level}`, board: this.practiceBoard(), chapterId: 0, mode: p.kind };
  }

  private async submitPractice(sentenceId: number, input: string, usedHint: boolean, elapsedMs: number): Promise<SubmitView> {
    const p = this.practice!; const s = this.sentences.get(sentenceId)!;
    const r = await this.d.grading.grade(input, s.answers, s.context);
    if (r.verdict === "ERROR") return { kind: "error", message: "채점 오류 — 답안은 보관되었습니다. 다시 시도해 주세요." };
    if (p.kind === "weak") { // 집중 공략은 정규 기록(오답노트·통계)에 남긴다. 자유 훈련은 아무것도 남기지 않는다.
      const ev: AppEvent = { v: 1, type: "AttemptGraded", sentenceId, patternId: s.patternId, verdict: r.verdict, usedHint, overTime: elapsedMs > timeLimitSec(s.en) * 1000, input, graderVersion: GRADER_VERSION, elapsedMs, at: this.d.now() };
      this.d.bus?.(ev);
      await this.d.store.recordAttempt(this.d.userId, ev);
      this.notes = onAttemptGraded(this.notes, ev, this.d.now());
    }
    if (r.verdict !== "MINOR_TYPO") { p.results.push({ patternId: s.patternId, ok: r.verdict === "PASS" && !usedHint, ms: elapsedMs }); p.answered = true; }
    return { kind: "graded", verdict: r.verdict, answer: s.answers[0] ?? s.en, patternCompleted: false, chapterCompleted: false, board: this.practiceBoard() };
  }

  /** 로드맵: 챕터별 진행 상태. 잠금 = 처음 미완료 챕터 이후. */
  async overview() {
    const all = await this.d.content.chapters(); const prog = await this.d.store.progress(this.d.userId);
    await this.rebuildNotes();
    const rows = all.map((c) => { const done = c.patternIds.filter((id) => prog.get(id)?.state === "done").length; return { chapterId: c.chapterId, level: c.level, total: c.patternIds.length, done }; });
    const cur = rows.findIndex((r) => r.done < r.total);
    const chapters = rows.map((r, i) => ({ ...r, status: r.done >= r.total ? "done" as const : i === cur ? "current" as const : "locked" as const }));
    const st = await this.statsView();
    return { chapters, currentChapterId: cur < 0 ? undefined : rows[cur]!.chapterId, activeChapterId: this.chapter?.chapterId, header: { streakDays: st.streakDays, mastered: this.notes.completed.size, wrongCount: this.notes.wrong.size }, totalPatterns: rows.reduce((a, r) => a + r.total, 0), totalDone: rows.reduce((a, r) => a + r.done, 0) };
  }

  /** 완료 취소: 연속 정답·복습 일정을 지우고 원래 챕터 대기열로 되돌린다. 열려 있던 챕터를 돌려준다. */
  async uncomplete(patternId: number): Promise<{ chapterId: number }> {
    const all = await this.d.content.chapters();
    const ch = all.find((c) => c.patternIds.includes(patternId)); if (!ch) throw new Error("패턴을 찾을 수 없다");
    const prog = await this.d.store.progress(this.d.userId); const cur = prog.get(patternId);
    await this.d.store.markUndone(this.d.userId, patternId, this.d.now());
    await this.d.store.deleteSchedule(this.d.userId, patternId);
    await this.d.store.saveProgress(this.d.userId, { patternId, streak: 0, state: "learning", hintOnlyStreak: 0, consecutiveFails: 0, seenSentenceIds: cur?.seenSentenceIds ?? [] } as PatternProgress);
    await this.open(ch.chapterId);
    return { chapterId: ch.chapterId };
  }

  next(): CardView | undefined {
    if (this.practice) return this.nextPractice();
    if (!this.session || !this.chapter) throw new Error("open() 먼저");
    const p = this.session.next(); if (!p) { this.current = undefined; return undefined; }
    this.current = p; const s = this.sentences.get(p.sentenceId)!;
    return { sentenceId: s.sentenceId, patternId: s.patternId, ko: s.ko, context: s.context, review: p.review, hintAvailable: !!(s.mustUse || this.templates.get(s.patternId)), timeLimitSec: timeLimitSec(s.en), patternNo: this.chapter.patternIds.indexOf(s.patternId) + 1, patternTemplate: this.templates.get(s.patternId) ?? "", level: this.chapter.level, board: this.session.board(), chapterId: this.chapter.chapterId, mode: "chapter" };
  }

  /** 힌트 = 필수 구문, 없으면 패턴 표현. 평소에는 화면에 패턴 표현을 보이지 않는다. */
  hint(sentenceId: number): string | undefined { const s = this.sentences.get(sentenceId); return s?.mustUse || this.templates.get(s?.patternId ?? -1) || undefined; }

  /** 오답·완료 노트 화면용. 한글·모범 정답·오류 유형을 붙이고 완료는 최근순으로 정렬한다. */
  async notesView() {
    const wrong = [];
    const typeCount: Record<string, number> = {}; const topMap: Array<{ patternId: number; template: string; wrongCount: number }> = [];
    for (const w of sortedWrong(this.notes)) {
      const ss = await this.sentencesOf(w.patternId); const s = this.sentences.get(w.sentenceId) ?? ss[0];
      const answer = s?.answers[0] ?? s?.en ?? ""; const tpl = this.templates.get(w.patternId) ?? "";
      const err = classifyError(w.lastWrongInput, answer, tpl.split(/\s+/));
      typeCount[err.type] = (typeCount[err.type] ?? 0) + w.wrongCount;
      topMap.push({ patternId: w.patternId, template: tpl, wrongCount: w.wrongCount });
      wrong.push({ ...w, sentenceId: s?.sentenceId ?? w.sentenceId, ko: s?.ko ?? "", answer, template: tpl, error: err });
    }
    const completed = [];
    for (const c of [...this.notes.completed.values()].sort((a, b) => b.completedAt - a.completedAt)) {
      const ss = await this.sentencesOf(c.patternId); const s = ss[0];
      completed.push({ ...c, ko: s?.ko ?? "", en: s?.answers[0] ?? s?.en ?? "", template: this.templates.get(c.patternId) ?? "" });
    }
    return { wrong, completed, typeCount, top3: topMap.slice(0, 3) };
  }

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
