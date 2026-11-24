import { useCallback, useEffect, useState } from "react";
import { api, type Overview, type OverviewAll } from "./api";
import { ChapterPath } from "./ChapterPath";
import { IslandMap } from "./IslandMap";
import { LEVELS, MAPS, SEA } from "./roadmapKit";
import { useToast } from "./ui";

const store = (k: string, v?: string) => { try { if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); } catch { return null; } };

/** 챕터 로드맵: 섬 지도(전체)와 챕터 길(카테고리 하나). 모바일은 한 화면씩 오가고, 웹은 나란히 보여 준다. */
export function Roadmap({ onStudy }: { onStudy: () => void }) {
  const toast = useToast();
  const [all, setAll] = useState<OverviewAll | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [sel, setSel] = useState<string>(() => { const s = store("roadmap"); return MAPS.some((m) => m.id === s) ? s! : "pattern"; });
  const [screen, setScreen] = useState<"map" | "detail">("map");

  const loadAll = useCallback(() => { void api.overviewAll().then((a) => {
    setAll(a);
    setSel((s) => (a.roadmaps.some((r) => r.id === s) ? s : "pattern")); // 보이지 않는 카테고리를 기억하고 있으면 패턴으로 되돌린다
    const prev = LEVELS.indexOf(store("userLevel") ?? ""), now = LEVELS.indexOf(a.userLevel ?? ""); // 레벨이 오르면 한 번 알려 준다(저장값이 없던 기기에서는 조용히 기록만)
    if (now > prev && a.userLevel) { if (prev >= 0) toast(`레벨 ${a.userLevel} 달성! 모든 카테고리의 ${a.userLevel} 이하 챕터가 열렸어요`, "ok"); store("userLevel", a.userLevel); }
  }).catch(() => setAll({ userLevel: null, roadmaps: [] })); }, [toast]);
  useEffect(loadAll, [loadAll]);
  useEffect(() => {
    setOv(null);
    void api.overview(sel).then((o) => { if (o.roadmap !== sel) setSel(o.roadmap); else setOv(o); }).catch(() => { if (sel !== "pattern") setSel("pattern"); }); // 서버가 다른 로드맵을 돌려주면(권한 밖) 그쪽으로 맞춘다
  }, [sel]);

  const pick = (id: string) => {
    if (!all?.roadmaps.some((r) => r.id === id)) { toast("아직 준비 중이에요", "info"); return; } // 닫힌(안개) 섬
    setSel(id); store("roadmap", id); setScreen("detail"); window.scrollTo({ top: 0 });
  };
  const go = async (chapterId: number) => { try { await api.open(chapterId); onStudy(); } catch { toast("아직 열리지 않은 챕터예요", "warn"); } };
  const meta = MAPS.find((m) => m.id === sel) ?? MAPS[0]!;
  const last = all?.roadmaps.find((r) => r.id === sel);

  if (!all) return <div className="py-20 text-center text-t3">불러오는 중…</div>;
  return (
    <div className="mx-auto max-w-md px-4 py-5 md:max-w-6xl md:grid md:grid-cols-[1.05fr_1fr] md:items-start md:gap-6">
      <section className={`${screen === "detail" ? "hidden md:block" : ""} md:sticky md:top-20`} aria-label="카테고리 섬 지도">
        <div className="mb-3 flex items-center gap-2">
          <span className="rounded-full bg-surface px-3 py-1.5 text-sm font-extrabold text-t1">{all.userLevel ? `내 레벨 ${all.userLevel}` : "내 레벨 시작 전"}</span>
          {last?.currentChapterId && <button onClick={() => void go(last.currentChapterId!)} className="ml-auto rounded-xl bg-sky px-3 py-1.5 text-sm font-extrabold text-app border-b-4 border-sky-d">⚡ {meta.n} 이어하기</button>}
        </div>
        <div className="overflow-hidden rounded-2xl border-2 border-cardb" style={{ background: SEA.b }}>
          <IslandMap data={all.roadmaps} selected={sel} onSelect={pick} />
        </div>
      </section>
      <section className={`${screen === "map" ? "hidden md:block" : ""} mt-0 md:mt-0`} aria-label="챕터 길">
        {ov && ov.roadmap === sel ? <ChapterPath key={ov.roadmap} ov={ov} title={meta.n} emoji={meta.e} onBack={() => { setScreen("map"); loadAll(); }} onGo={(id) => void go(id)} onLocked={() => toast("앞 챕터를 모두 마치거나 레벨을 올리면 열려요", "warn")} />
          : <div className="py-20 text-center text-t3">불러오는 중…</div>}
      </section>
    </div>
  );
}
