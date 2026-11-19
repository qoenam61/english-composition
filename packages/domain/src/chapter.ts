import type { PatternProgress } from "./types.js";

export interface ChapterBoard {
  total: number;
  done: number;
  remaining: number;
  badges: boolean[]; // 패턴 순서대로, true = 완료(채운 배지)
  complete: boolean;
}

export function chapterBoard(patternIds: number[], progress: Map<number, PatternProgress>): ChapterBoard {
  const badges = patternIds.map((id) => progress.get(id)?.state === "done");
  const done = badges.filter(Boolean).length;
  return { total: patternIds.length, done, remaining: patternIds.length - done, badges, complete: done === patternIds.length && patternIds.length > 0 };
}
