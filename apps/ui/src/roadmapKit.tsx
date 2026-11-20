/** 섬 지도·챕터 길이 함께 쓰는 도구: 단계(입문·중급·고급) 색, 별 배지, 섬 모양. 설계 시안과 같은 시각 언어. */
export const TN = ["입문", "중급", "고급"] as const;
export const TIER_COLOR = ["#58CC02", "#FF9600", "#CE82FF"] as const; // 앱 팔레트의 green / orange / purple
export const LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"];
export const tierOfLevel = (lv: string) => Math.min(2, Math.max(0, Math.ceil((LEVELS.indexOf(lv) + 1) / 2) - 1));
export const MAPS: Array<{ id: string; e: string; n: string }> = [
  { id: "pattern", e: "★", n: "패턴 학습" }, { id: "daily-talk", e: "🏠", n: "일상·스몰토크" }, { id: "workplace", e: "💼", n: "직장 업무" },
  { id: "presentation", e: "🎤", n: "발표·토론" }, { id: "interview", e: "🤝", n: "면접·취업" }, { id: "school", e: "🏫", n: "학교·학업" },
  { id: "hospital", e: "🏥", n: "병원·건강" }, { id: "restaurant", e: "🍽️", n: "식당·카페" }, { id: "shopping-service", e: "🛍️", n: "쇼핑·서비스" },
  { id: "travel", e: "✈️", n: "여행·출장" },
];
export const SEA = { a: "#1d3d4a", b: "#12272f" };
export const LAND = { fill: "#4a4533", line: "#7d7352", fog: "#2c3e46" };

export const starPts = (cx: number, cy: number, R: number) => Array.from({ length: 10 }, (_, i) => {
  const a = ((-90 + i * 36) * Math.PI) / 180, r = i % 2 ? R * 0.47 : R; return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
}).join(" ");
/** 단계 별 배지. 속이 찬 별 = 시작함, 속 빈 별 = 탐험 전. 안의 숫자(1·2·3, 완주는 ✓)로 색을 구분하지 못해도 읽힌다. */
export function Star({ cx, cy, R, tier, filled, num }: { cx: number; cy: number; R: number; tier: number; filled: boolean; num?: string | number }) {
  const c = TIER_COLOR[Math.min(2, tier)]!;
  return (
    <g pointerEvents="none">
      <polygon points={starPts(cx, cy, R)} fill={filled ? c : "#1B2B32"} stroke={filled ? "#1B2B32" : c} strokeWidth={filled ? 2.2 : 2.4} strokeLinejoin="round" />
      {num !== undefined && <text x={cx} y={cy + R * 0.28} textAnchor="middle" fontSize={R * 0.78} fontWeight={800} fill={filled ? "#131F24" : c}>{num}</text>}
    </g>
  );
}
export function Chip({ cx, cy, text, color, filled }: { cx: number; cy: number; text: string; color: string; filled: boolean }) {
  const w = text.length * 7 + 18;
  return (
    <g pointerEvents="none">
      <rect x={cx - w / 2} y={cy - 10} width={w} height={18} rx={9} fill={filled ? color : "#1B2B32"} stroke={color} strokeWidth={1.6} />
      <text x={cx} y={cy + 3} textAnchor="middle" fontSize={10.5} fontWeight={800} fill={filled ? "#131F24" : color}>{text}</text>
    </g>
  );
}
const seedRnd = (s: number) => () => (s = (s * 16807) % 2147483647) / 2147483647;
export function blob(cx: number, cy: number, r: number, seed: number, flat = 0.86): string {
  const rnd = seedRnd(Math.max(1, Math.floor(seed))), N = 9, pts: Array<[number, number]> = [];
  for (let k = 0; k < N; k++) { const a = (k / N) * Math.PI * 2, rr = r * (0.84 + rnd() * 0.26); pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a) * flat]); }
  const m = (a: [number, number], b: [number, number]): [number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let d = `M${m(pts[N - 1]!, pts[0]!)}`; for (let k = 0; k < N; k++) d += `Q${pts[k]} ${m(pts[k]!, pts[(k + 1) % N]!)}`; return d + "Z";
}
export const arcD = (cx: number, cy: number, r: number, a0: number, a1: number) => {
  const p = (a: number) => [cx + r * Math.cos((a * Math.PI) / 180), cy + r * Math.sin((a * Math.PI) / 180)] as const; const [x0, y0] = p(a0), [x1, y1] = p(a1);
  return `M${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};
export const keyAct = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } };
