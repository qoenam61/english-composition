export const SRS_DAYS = [1, 3, 7, 14] as const;
const DAY_MS = 86_400_000;

/** box: 0부터. 완료 직후 box 0 의 due = +1일. 복습 정답이면 다음 박스, 오답이면 box 0. */
export function nextDue(box: number, now: number): number {
  const d = SRS_DAYS[Math.min(box, SRS_DAYS.length - 1)]!;
  return now + d * DAY_MS;
}
export function nextBox(box: number, passed: boolean): number {
  return passed ? Math.min(box + 1, SRS_DAYS.length - 1) : 0;
}
