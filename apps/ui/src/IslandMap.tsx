import type { MapRoadmap } from "./api";
import { arcD, blob, Chip, keyAct, LAND, MAPS, SEA, Star, TIER_COLOR, TN } from "./roadmapKit";

/** 섬 지도: 카테고리 = 섬, 섬을 두른 3분할 고리 = 입문·중급·고급 진행도, 별 배지 = 지금 단계.
 *  서버가 보내지 않은 카테고리(일반 사용자에게 아직 닫힌 장소)는 안개 낀 "준비 중" 섬으로 그린다. */
export function IslandMap({ data, selected, onSelect }: { data: MapRoadmap[]; selected: string; onSelect: (id: string) => void }) {
  const pos = MAPS.map((_, i) => i === 0 ? { x: 200, y: 285, r: 58, ring: 78 } : (() => { const a = ((-90 + (i - 1) * 40) * Math.PI) / 180; return { x: 200 + 150 * Math.cos(a), y: 285 + 200 * Math.sin(a), r: 30, ring: 41 }; })());
  return (
    <svg viewBox="0 0 400 580" className="w-full h-auto block" role="group" aria-label="카테고리 섬 지도">
      <defs><radialGradient id="sea" cx="50%" cy="45%" r="70%"><stop offset="0" stopColor={SEA.a} /><stop offset="1" stopColor={SEA.b} /></radialGradient></defs>
      <rect width="400" height="580" fill="url(#sea)" />
      {MAPS.slice(1).map((_, i) => <path key={i} d={`M200 285L${pos[i + 1]!.x} ${pos[i + 1]!.y}`} fill="none" stroke="#8B9EB0" strokeWidth={1.6} strokeDasharray="2 7" strokeLinecap="round" opacity={0.5} />)}
      {MAPS.map((m, i) => {
        const d = data.find((x) => x.id === m.id); const { x, y, r, ring } = pos[i]!; const soon = !d;
        const ct = d ? d.currentTier : 0; const allDone = !!d && ct === 3; const t = Math.min(ct, 2); const col = TIER_COLOR[t]!;
        const cur = d?.tiers[t]; const started = !!d?.started || allDone;
        const act = () => onSelect(m.id);
        return (
          <g key={m.id} className="isl" tabIndex={0} role="button" aria-label={`${m.n} ${soon ? "준비 중" : allDone ? "완주" : `${TN[t]} 단계`}`} onClick={act} onKeyDown={keyAct(act)}>
            {m.id === selected && <circle cx={x} cy={y} r={ring + 8} fill="none" stroke="#fff" strokeWidth={2} strokeDasharray="4 5" opacity={0.6} />}
            {[0, 1, 2].map((tt) => {
              const a0 = -90 + tt * 120 + 9, a1 = -90 + tt * 120 + 111; const st = d?.tiers[tt]; const frac = st && st.total ? st.done / st.total : 0;
              return (
                <g key={tt}>
                  <path d={arcD(x, y, ring, a0, a1)} fill="none" stroke={st && st.open > 0 ? TIER_COLOR[tt] : LAND.line} strokeWidth={6} strokeLinecap="round" opacity={st && st.open > 0 ? 0.28 : 0.5} />
                  {frac > 0 && <path d={arcD(x, y, ring, a0, a0 + (a1 - a0) * frac)} fill="none" stroke={TIER_COLOR[tt]} strokeWidth={6} strokeLinecap="round" />}
                </g>
              );
            })}
            <path d={blob(x, y, r, 11 + i * 7)} fill={LAND.fill} stroke={LAND.line} strokeWidth={2.5} strokeLinejoin="round" />
            <text x={x} y={y + (i ? 8 : 10)} textAnchor="middle" fontSize={i ? 24 : 38} pointerEvents="none" opacity={soon ? 0.35 : 1}>{m.e}</text>
            {soon && <path d={blob(x, y, ring + 2, 3 + i, 0.9)} fill={LAND.fog} opacity={0.72} pointerEvents="none" />}
            <text x={x} y={y + ring + 17} textAnchor="middle" fontSize={12} fontWeight={800} fill="#fff" pointerEvents="none" paintOrder="stroke" stroke="#12272f" strokeWidth={3} strokeLinejoin="round">{m.n}</text>
            {soon ? <Chip cx={x} cy={y + ring + 32} text="준비 중" color="#8B9EB0" filled={false} />
              : <>
                <Chip cx={x} cy={y + ring + 32} text={allDone ? "완주" : `${TN[t]} · ${cur?.done ?? 0}/${cur?.total ?? 0}`} color={col} filled={started} />
                <Star cx={x + ring * 0.72} cy={y - ring * 0.72} R={i ? 14 : 18} tier={t} filled={started} num={allDone ? "✓" : t + 1} />
              </>}
          </g>
        );
      })}
    </svg>
  );
}
