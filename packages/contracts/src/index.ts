import type { PatternProgress, Verdict } from "@app/domain";

// ---- 이벤트 (버전 있는 스키마) ----
export interface AnswerSubmitted { v: 1; type: "AnswerSubmitted"; sentenceId: number; patternId: number; input: string; usedHint: boolean; elapsedMs: number; overTime: boolean }
export interface AttemptGraded { v: 1; type: "AttemptGraded"; sentenceId: number; patternId: number; verdict: Verdict; usedHint: boolean; overTime: boolean; input: string; graderVersion: string; elapsedMs?: number; at?: number }
export interface PatternCompleted { v: 1; type: "PatternCompleted"; patternId: number; chapterId: number }
export interface ChapterCompleted { v: 1; type: "ChapterCompleted"; chapterId: number }
export interface ReviewDue { v: 1; type: "ReviewDue"; patternId: number }
export type AppEvent = AnswerSubmitted | AttemptGraded | PatternCompleted | ChapterCompleted | ReviewDue;

// ---- 포트 ----
export interface PatternRef { patternId: number; template: string; level: string }
export interface SentenceRef { sentenceId: number; patternId: number; track: "original" | "own"; en: string; ko: string; context?: string; mustUse?: string; answers: string[] }
export interface ChapterRef { chapterId: number; level: string; patternIds: number[]; roadmap?: string }
export interface RoadmapRef { id: string; label: string }

export interface ContentRepository {
  /** roadmap 생략 = 패턴 로드맵, "*" = 전체(챕터 ID로 찾을 때). */
  chapters(roadmap?: string): Promise<ChapterRef[]>;
  roadmaps?(): Promise<RoadmapRef[]>;
  pattern(id: number): Promise<PatternRef | undefined>;
  sentences(patternId: number, enabledTracks: ReadonlyArray<"original" | "own">): Promise<SentenceRef[]>;
}
export interface AttemptRecord { patternId: number; sentenceId: number; verdict: Verdict; usedHint: boolean; overTime: boolean; elapsedMs: number; input: string; at: number }
export interface UserStore {
  attempts(userId: string): Promise<AttemptRecord[]>;
  recordCompletion(userId: string, patternId: number, at: number): Promise<void>;
  completions(userId: string): Promise<Array<{ patternId: number; at: number; undoneAt?: number }>>;
  markUndone(userId: string, patternId: number, at: number): Promise<void>;
  deleteSchedule(userId: string, patternId: number): Promise<void>;
  progress(userId: string): Promise<Map<number, PatternProgress>>;
  saveProgress(userId: string, p: PatternProgress): Promise<void>;
  recordAttempt(userId: string, e: AttemptGraded): Promise<void>;
  dueReviews(userId: string, now: number): Promise<number[]>;
}
export interface JudgeInfo { ko?: string; template?: string; genderFree?: boolean }
export interface JudgeOutcome { verdict: Verdict; comment?: string }
/** 반환은 Verdict 문자열 또는 코멘트가 붙은 결과(둘 다 허용). */
export interface LlmJudge { judge(input: string, answers: string[], context?: string, info?: JudgeInfo): Promise<Verdict | JudgeOutcome> }
export interface SpeechInput { available(): boolean; start(onText: (t: string, confidence: number) => void): void; stop(): void }
export interface SpeechOutput { speak(text: string): Promise<void> }
export interface Haptics { pulse(kind: "pass" | "fail"): void }
export interface Notifier { notify(message: string): void }
export interface EventBus { publish(e: AppEvent): void; subscribe<T extends AppEvent["type"]>(type: T, fn: (e: Extract<AppEvent, { type: T }>) => void): void }
