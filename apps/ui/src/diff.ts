/** 비교용 정규화: 대소문자·문장부호(, . ? !)는 무시하고 단어만 본다. */
export const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9'’]/g, "").replace(/’/g, "'");
const toks = (s: string) => s.trim().split(/\s+/).filter(Boolean);
export interface Tok { text: string; bad: boolean }

/** 단어 단위 LCS 로 내 입력의 틀린 단어와 정답의 교정 단어를 표시한다. */
export function diffWords(input: string, answer: string): { mine: Tok[]; ans: Tok[] } {
  const a = toks(input), b = toks(answer);
  const na = a.map(norm), nb = b.map(norm);
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i]![j] = na[i] === nb[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const mine: Tok[] = a.map((t) => ({ text: t, bad: true })), ans: Tok[] = b.map((t) => ({ text: t, bad: true }));
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (na[i] === nb[j]) { mine[i]!.bad = false; ans[j]!.bad = false; i++; j++; }
    else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) i++; else j++;
  }
  return { mine, ans };
}
