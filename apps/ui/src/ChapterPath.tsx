import { useState } from "react";
import type { Chapter, Overview } from "./api";
import { blob, Chip, keyAct, LAND, SEA, Star, TIER_COLOR, tierOfLevel, TN } from "./roadmapKit";

const OFFS = [0, 70, 105, 70, 0, -70, -105, -70];
const PER = 8, ROW = 104;

/** 카테고리 하나의 챕터 길. 섬 지도와 같은 말을 쓴다: 챕터 = 돌섬, 현재 = 별 배지와 물결, 잠김 = 안개, 단계 탭·깃발 = 같은 단계 색. */
export function ChapterPath({ ov, title, emoji, onBack, onGo, onLocked }: { ov: Overview; title: string; emoji: string; onBack: () => void; onGo: (chapterId: number) => void; onLocked: () => void }) {
  const cur = ov.chapters.find((c) => c.chapterId === ov.currentChapterId);
  const curTier = cur ? tierOfLevel(cur.level) : 2;
  const byTier = [0, 1, 2].map((t) => ov.chapters.filter((c) => tierOfLevel(c.level) === t));
  const [tab, setTab] = useState(curTier);
  const list0 = byTier[tab]!; const curIdx = list0.findIndex((c) => c.chapterId === ov.currentChapterId);
  const [page, setPage] = useState(Math.max(0, Math.floor(curIdx / PER)));
  const pages = Math.max(1, Math.ceil(list0.length / PER)); const p = Math.min(page, pages - 1);
  const list = list0.slice(p * PER, p * PER + PER);
  const stats = byTier.map((cs) => ({ n: cs.length, done: cs.filter((c) => c.status === "done").length }));
  const allDone = !cur; const accent = TIER_COLOR[Math.min(curTier, 2)]!;
  const H = 70 + Math.max(1, list.length) * ROW;
  const pts = list.map((_, i) => ({ x: 200 + OFFS[i % 8]!, y: 100 + i * ROW }));
  const pick = (k: number) => { setTab(k); const i = byTier[k]!.findIndex((c) => c.chapterId === ov.currentChapterId); setPage(Math.max(0, Math.floor(i / PER))); };
  const act = (c: Chapter) => () => (c.status === "locked" ? onLocked() : onGo(c.chapterId));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5 min-w-0">
        <button onClick={onBack} className="md:hidden shrink-0 rounded-xl border-2 border-cardb bg-surface px-3 py-1.5 text-sm font-bold text-t2">← 지도</button>
        <span className="min-w-0 truncate text-lg font-black text-t1">{emoji} {title}</span>
        <span className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-extrabold text-app" style={{ background: allDone ? TIER_COLOR[2] : accent }}>
          {allDone ? "✓ 완주" : <><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden><Star cx={9} cy={9.6} R={8.5} tier={curTier} filled num={curTier + 1} /></svg>{TN[curTier]}</>}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5" role="tablist" aria-label="난이도">
        {[0, 1, 2].map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => pick(k)} className="flex flex-col items-center gap-1 rounded-xl bg-surface py-2 text-xs text-t3" style={{ border: `2px solid ${tab === k ? TIER_COLOR[k] : "#2A3F48"}` }}>
            <b className="inline-flex items-center gap-1 text-sm text-t1"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><Star cx={8} cy={8.6} R={7.5} tier={k} filled num={k + 1} /></svg>{TN[k]}</b>
            <span>{stats[k]!.done}/{stats[k]!.n}챕터</span>
            <span className="h-1.5 w-4/5 overflow-hidden rounded bg-cardb"><i className="block h-full rounded" style={{ width: `${stats[k]!.n ? (stats[k]!.done / stats[k]!.n) * 100 : 0}%`, background: TIER_COLOR[k] }} /></span>
          </button>
        ))}
      </div>
      <button disabled={allDone} onClick={() => cur && onGo(cur.chapterId)} className="w-full rounded-xl py-3 text-base font-extrabold text-app border-b-4 border-black/25 transition-all active:translate-y-[4px] active:border-b-transparent disabled:opacity-40" style={{ background: accent }}>
        {allDone ? "모든 챕터를 마쳤어요" : `⚡ 이어하기 · 챕터 ${cur!.no}`}
      </button>
      <div className="overflow-hidden rounded-2xl border-2 border-cardb" style={{ background: `radial-gradient(circle at 50% 30%, ${SEA.a}, ${SEA.b} 75%)` }}>
        <svg viewBox={`0 0 400 ${H}`} className="block h-auto w-full" role="group" aria-label={`${TN[tab]} 구역 챕터 길`}>
          <rect x={90} y={14} width={220} height={30} rx={15} fill={TIER_COLOR[tab]} />
          <text x={200} y={34} textAnchor="middle" fontSize={13} fontWeight={800} fill="#131F24">{list0.length ? `${TN[tab]} 구역 · 챕터 ${list0[0]!.no}–${list0[list0.length - 1]!.no}` : `${TN[tab]} 구역`}</text>
          {!list0.length && <text x={200} y={110} textAnchor="middle" fontSize={13} fill="#8B9EB0">이 단계에는 아직 챕터가 없어요</text>}
          {pts.map((q, i) => {
            if (!i) return null; const a = pts[i - 1]!, done = list[i]!.status === "done";
            return <path key={i} d={`M${a.x} ${a.y}C${a.x} ${a.y + 52} ${q.x} ${q.y - 52} ${q.x} ${q.y}`} fill="none" stroke={done ? TIER_COLOR[tab] : "#8B9EB0"} strokeWidth={done ? 4 : 1.8} strokeDasharray={done ? undefined : "2 7"} strokeLinecap="round" opacity={done ? 0.8 : 0.5} />;
          })}
          {list.map((c, i) => {
            const { x, y } = pts[i]!; const st = c.status; const rim = st === "done" || st === "current" ? TIER_COLOR[tab]! : st === "open" ? "#E2E8F0" : LAND.line;
            return (
              <g key={c.chapterId} className="isl" tabIndex={0} role="button" aria-label={`챕터 ${c.no} ${{ done: "완료", current: "진행 중", open: "열림", locked: "잠김" }[st]}`} onClick={act(c)} onKeyDown={keyAct(act(c))}>
                {st === "current" && <circle cx={x} cy={y} r={36} className="pulse-svg" fill="none" stroke={TIER_COLOR[tab]} strokeWidth={3} />}
                <path d={blob(x, y, st === "current" ? 34 : 29, 5 + c.no * 13)} fill={LAND.fill} stroke={rim} strokeWidth={st === "current" ? 4 : 3} strokeDasharray={st === "open" ? "5 4" : undefined} strokeLinejoin="round" />
                <text x={x} y={y + 6} textAnchor="middle" fontSize={18} fontWeight={800} fill="#fff" pointerEvents="none" opacity={st === "locked" ? 0.4 : 1}>{st === "done" ? "✓" : c.no}</text>
                {st === "done" && <text x={x} y={y + 24} textAnchor="middle" fontSize={10} fill="#8B9EB0" pointerEvents="none">{c.no}</text>}
                {st === "locked" && <><path d={blob(x, y, 31, 5 + c.no * 13)} fill={LAND.fog} opacity={0.78} pointerEvents="none" /><text x={x} y={y + 6} textAnchor="middle" fontSize={15} pointerEvents="none">🔒</text></>}
                {st === "current" && <><Star cx={x + 27} cy={y - 27} R={14} tier={tab} filled num={tab + 1} /><Chip cx={x} cy={y + 50} text={`${c.done}/${c.total} 문장`} color={TIER_COLOR[tab]!} filled /></>}
                {st === "open" && c.done > 0 && <Chip cx={x} cy={y + 46} text={`${c.done}/${c.total}`} color="#E2E8F0" filled={false} />}
              </g>
            );
          })}
        </svg>
      </div>
      {pages > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm text-t3">
          <button disabled={p === 0} onClick={() => setPage(p - 1)} className="rounded-lg bg-surface px-3 py-1.5 font-bold text-t2 disabled:opacity-30">◀ 이전</button>
          <span className="font-bold">{p + 1} / {pages}쪽</span>
          <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)} className="rounded-lg bg-surface px-3 py-1.5 font-bold text-t2 disabled:opacity-30">다음 ▶</button>
        </div>
      )}
    </div>
  );
}
