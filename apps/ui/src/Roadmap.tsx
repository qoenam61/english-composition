import { useEffect, useState } from "react";
import { api, type Overview } from "./api";
import { Btn, Card, useToast } from "./ui";

const OFFS = [0, 70, 105, 70, 0, -70, -105, -70];
const PER = 8, ROW = 118;

export function Roadmap({ onStudy }: { onStudy: () => void }) {
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null); const [page, setPage] = useState(0);
  useEffect(() => { void api.overview().then((o) => { setOv(o); const i = o.chapters.findIndex((c) => c.chapterId === o.currentChapterId); setPage(Math.max(0, Math.floor(i / PER))); }); }, []);
  if (!ov) return <div className="py-20 text-center text-t3">불러오는 중…</div>;
  const pages = Math.ceil(ov.chapters.length / PER); const list = ov.chapters.slice(page * PER, page * PER + PER);
  const cur = ov.chapters.find((c) => c.chapterId === (ov.activeChapterId ?? ov.currentChapterId)) ?? ov.chapters.find((c) => c.status === "current");
  const go = async (id: number) => { await api.open(id); onStudy(); };
  const pts = list.map((_, i) => ({ x: 160 + OFFS[i % PER]!, y: i * ROW + 44 }));
  const path = pts.map((p, i) => (i === 0 ? `M${p.x} ${p.y}` : `C${pts[i - 1]!.x} ${pts[i - 1]!.y + ROW / 2} ${p.x} ${p.y - ROW / 2} ${p.x} ${p.y}`)).join(" ");
  return (
    <div className="max-w-2xl mx-auto px-4 py-5">
      {cur && (
        <Card className="p-4 flex items-center justify-between gap-3 mb-5">
          <div className="min-w-0"><div className="text-xs text-t3">현재 진행 중</div><div className="font-extrabold text-t1 truncate">{cur.level} · 챕터 {cur.chapterId} <span className="text-t3 text-sm font-bold">({cur.done}/{cur.total})</span></div></div>
          <Btn onClick={() => void go(cur.chapterId)} className="shrink-0 text-sm">⚡ 마지막 학습 이어하기</Btn>
        </Card>
      )}
      <div className="flex items-center justify-between mb-2 text-sm text-t2">
        <button disabled={page === 0} onClick={() => setPage(page - 1)} className="px-3 py-1.5 rounded-lg bg-surface disabled:opacity-30">◀ 이전</button>
        <span className="font-bold">챕터 {list[0]?.chapterId}–{list[list.length - 1]?.chapterId} <span className="text-t3">({page + 1}/{pages})</span></span>
        <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="px-3 py-1.5 rounded-lg bg-surface disabled:opacity-30">다음 ▶</button>
      </div>
      <div className="relative mx-auto mt-12" style={{ width: 320, maxWidth: "100%", height: list.length * ROW + 20 }}>
        <svg className="absolute inset-0" width="320" height={list.length * ROW + 20} viewBox={`0 0 320 ${list.length * ROW + 20}`} aria-hidden><path d={path} fill="none" stroke="#2A3F48" strokeWidth="8" strokeLinecap="round" strokeDasharray="2 14" /></svg>
        {list.map((c, i) => {
          const p = pts[i]!; const tone = c.status === "done" ? "bg-gold border-gold-d text-app" : c.status === "current" ? "bg-sky border-sky-d text-white" : "bg-surface border-app text-t3";
          return (
            <div key={c.chapterId} className="absolute" style={{ left: p.x - 40, top: p.y - 40 }}>
              {c.status === "current" && <><span className="absolute inset-0 rounded-full bg-sky/40 pulse-ring" /><span className="absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap bg-white text-app text-xs font-extrabold rounded-lg px-2.5 py-1 after:content-[''] after:absolute after:top-full after:left-1/2 after:-translate-x-1/2 after:border-4 after:border-transparent after:border-t-white">시작하기!</span></>}
              <button onClick={() => c.status === "locked" ? toast("앞 챕터를 모두 마치면 열려요", "warn") : void go(c.chapterId)} aria-label={`챕터 ${c.chapterId} ${c.status}`}
                className={`relative w-20 h-20 rounded-full border-b-[6px] font-black text-lg grid place-items-center transition-all duration-100 active:border-b-transparent active:translate-y-[6px] ${tone}`}>
                {c.status === "done" ? "👑" : c.status === "locked" ? "🔒" : c.chapterId}
              </button>
              <div className="text-center text-[11px] text-t3 mt-1.5">{c.level} · {c.chapterId} · {c.done}/{c.total}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
