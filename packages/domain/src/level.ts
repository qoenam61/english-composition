/** 사용자 레벨과 챕터 해금 규칙(순수 함수). 설계: docs/level-unlock-plan.md §2.
 *  전제: 한 로드맵 안에서 챕터는 레벨 오름차순이다(팩 빌드가 검증). */
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
/** A1=1 … C2=6, 모르는 값은 0. */
export const rankOf = (level: string): number => LEVELS.indexOf(level as (typeof LEVELS)[number]) + 1;
export const levelOf = (rank: number): string | undefined => LEVELS[rank - 1];
/** 화면의 3단계: 입문(A1·A2) 0, 중급(B1·B2) 1, 고급(C1·C2) 2. */
export const tierOf = (level: string): 0 | 1 | 2 => (Math.min(3, Math.max(1, Math.ceil(rankOf(level) / 2))) - 1) as 0 | 1 | 2;

export interface LevelChapter { chapterId: number; level: string; patternIds: number[] }
export interface LevelRoadmap { id: string; chapters: LevelChapter[] }
export type ChapterStatus = "done" | "current" | "open" | "locked";
export type IsDone = (patternId: number) => boolean;

/** 사용자 레벨에 기여할 수 있는 로드맵의 최소 패턴 수. 아주 작은 로드맵 하나를 끝내 전체가 열리는 것을 막는다. */
export const MIN_ITEMS = 100;

const chapterDone = (c: LevelChapter, done: IsDone) => c.patternIds.every(done);

/** R에서 레벨 U 위로 실제 입증한 가장 높은 레벨 rank. U < rank ≤ L 인 모든 챕터가 끝난 L(로드맵에 있는 레벨만). 없으면 U. */
export function provenRank(chapters: LevelChapter[], done: IsDone, u: number): number {
  let best = u;
  const levels = [...new Set(chapters.map((c) => rankOf(c.level)))].filter((r) => r > u).sort((a, b) => a - b);
  for (const l of levels) {
    const upto = chapters.filter((c) => { const r = rankOf(c.level); return r > u && r <= l; });
    if (upto.every((c) => chapterDone(c, done))) best = l; else break;
  }
  return best;
}

/** 저장된 레벨과 모든 자격 있는 로드맵의 입증 레벨 중 최댓값. 값이 안정될 때까지 반복한다(오르기만 한다). */
export function computeUserLevel(roadmaps: LevelRoadmap[], done: IsDone, stored: number, minItems = MIN_ITEMS): number {
  const eligible = roadmaps.filter((r) => new Set(r.chapters.flatMap((c) => c.patternIds)).size >= minItems);
  let u = Math.max(0, stored);
  for (let i = 0; i < 7; i++) {
    const next = Math.max(u, ...eligible.map((r) => provenRank(r.chapters, done, u)));
    if (next === u) break;
    u = next;
  }
  return u;
}

/** 챕터별 상태. 열림 = rank ≤ U 또는 frontier(U 위 첫 미완료). current = 열린 미완료 중 rank ≥ U 첫 챕터(없으면 첫 미완료). */
export function chapterStatuses(chapters: LevelChapter[], done: IsDone, u: number): ChapterStatus[] {
  const dn = chapters.map((c) => chapterDone(c, done));
  const frontier = chapters.findIndex((c, i) => !dn[i] && rankOf(c.level) > u);
  const isOpen = (i: number) => rankOf(chapters[i]!.level) <= u || i === frontier;
  const firstUndone = dn.indexOf(false);
  let cur = chapters.findIndex((_, i) => !dn[i] && isOpen(i) && rankOf(chapters[i]!.level) >= u);
  if (cur < 0) cur = firstUndone;
  return chapters.map((_, i) => dn[i] ? "done" : i === cur ? "current" : isOpen(i) ? "open" : "locked");
}
