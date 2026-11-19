import type { PatternProgress } from "./types.js";

export interface PickContext {
  chapterPatternIds: number[];
  progress: Map<number, PatternProgress>;
  sentencesByPattern: Map<number, number[]>;
  dueReviewPatternIds: number[];
  lastPatternId?: number;
  rng: () => number; // 0~1, 주입(테스트 가능)
  reviewMixRate?: number; // 기본 0.12 (10~15%)
}

export interface Pick { patternId: number; sentenceId: number; review: boolean }

function pickSentence(ids: number[], seen: number[], rng: () => number): number | undefined {
  if (ids.length === 0) return undefined;
  const unseen = ids.filter((id) => !seen.includes(id));
  const pool = unseen.length > 0 ? unseen : ids; // 미출제 문장 우선
  return pool[Math.floor(rng() * pool.length)];
}

/** 완료 패턴은 복습일에만 출제(도장깨기). 챕터가 모두 완료되고 복습도 없으면 undefined. */
export function pickNext(c: PickContext): Pick | undefined {
  const rate = c.reviewMixRate ?? 0.12;
  const reviews = c.dueReviewPatternIds.filter((id) => id !== c.lastPatternId);
  if (reviews.length > 0 && c.rng() < rate) {
    const patternId = reviews[Math.floor(c.rng() * reviews.length)]!;
    const sid = pickSentence(c.sentencesByPattern.get(patternId) ?? [], c.progress.get(patternId)?.seenSentenceIds ?? [], c.rng);
    if (sid !== undefined) return { patternId, sentenceId: sid, review: true };
  }
  const open = c.chapterPatternIds.filter((id) => c.progress.get(id)?.state !== "done");
  if (open.length === 0) {
    const r = reviews[0];
    if (r === undefined) return undefined;
    const sid = pickSentence(c.sentencesByPattern.get(r) ?? [], c.progress.get(r)?.seenSentenceIds ?? [], c.rng);
    return sid === undefined ? undefined : { patternId: r, sentenceId: sid, review: true };
  }
  const candidates = open.length > 1 ? open.filter((id) => id !== c.lastPatternId) : open; // 직전 패턴 연속 차단
  const patternId = candidates[Math.floor(c.rng() * candidates.length)]!;
  const sid = pickSentence(c.sentencesByPattern.get(patternId) ?? [], c.progress.get(patternId)?.seenSentenceIds ?? [], c.rng);
  return sid === undefined ? undefined : { patternId, sentenceId: sid, review: false };
}
