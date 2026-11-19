import { useCallback, useEffect, useState } from "react";
import { api, type Overview } from "./api";
import { Completed, WrongNotes } from "./Notes";
import { Practice } from "./Practice";
import { Roadmap } from "./Roadmap";
import { Trainer } from "./Trainer";
import { ToastHost, useToast } from "./ui";

type Tab = "study" | "wrong" | "done" | "practice" | "roadmap";
// 학습하기는 내비게이션에 노출하지 않는다: 챕터 로드맵의 이어하기·챕터 버튼으로만 들어간다.
const TABS: Array<[Tab, string, string]> = [["roadmap", "챕터 로드맵", "🗺️"], ["wrong", "오답노트", "📒"], ["done", "학습완료", "🏅"], ["practice", "자유훈련", "⚡"]];

function Shell() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>(() => (TABS.map(([t]) => t).find((t) => t === location.hash.slice(1)) ?? "roadmap"));
  const [launch, setLaunch] = useState<"chapter" | "weak">("chapter");
  const [key, setKey] = useState(0);
  const [ov, setOv] = useState<Overview | null>(null);
  const [typing, setTyping] = useState(false);
  const refresh = useCallback(() => { void api.overview().then(setOv).catch(() => {}); }, []);
  useEffect(refresh, [refresh, tab]);
  useEffect(() => { history.replaceState(null, "", "#" + tab); }, [tab]);
  useEffect(() => {
    const on = (e: FocusEvent) => setTyping((e.target as HTMLElement)?.tagName === "TEXTAREA" && e.type === "focusin");
    document.addEventListener("focusin", on); document.addEventListener("focusout", on);
    return () => { document.removeEventListener("focusin", on); document.removeEventListener("focusout", on); };
  }, []);

  const goStudy = async () => { await api.exitPractice(); setLaunch("chapter"); setKey((k) => k + 1); setTab("study"); };
  const select = (t: Tab) => { void api.exitPractice(); setTab(t); };
  const active: Tab = tab === "study" ? "roadmap" : tab; // 학습 화면은 로드맵의 하위 화면
  const startWeak = async (sentence?: number) => {
    const r = await api.practice("weak", sentence ? { n: 1, sentence } : { n: 5 });
    if (!r.ok) { toast(r.reason, "warn"); return; }
    setLaunch("weak"); setKey((k) => k + 1); setTab("study");
  };
  const h = ov?.header;
  const badge = h && h.wrongCount > 0 ? <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-red text-white text-[11px] font-extrabold inline-grid place-items-center">{h.wrongCount}</span> : null;
  const stats = <div className="flex items-center gap-2 text-sm font-extrabold"><span className="rounded-lg bg-orange/15 text-orange px-2.5 py-1">🔥 {h?.streakDays ?? 0}일</span><span className="rounded-lg bg-sky/15 text-sky px-2.5 py-1">💎 {h?.mastered ?? 0}개</span></div>;

  return (
    <div className="min-h-[100dvh] bg-app text-t2 flex flex-col">
      <header className="hidden md:flex sticky top-0 z-30 h-16 items-center justify-between gap-4 px-6 bg-app border-b-2 border-cardb">
        <div className="font-black text-t1 text-lg whitespace-nowrap">패턴 영작</div>
        <nav className="flex gap-1">{TABS.map(([t, l]) => <button key={t} onClick={() => select(t)} className={`px-4 py-2 rounded-xl font-bold flex items-center ${active === t ? "bg-sky/15 text-sky" : "text-t3 hover:text-t2"}`}>{l}{t === "wrong" && badge}</button>)}</nav>
        {stats}
      </header>
      <header className="md:hidden sticky top-0 z-30 flex items-center justify-between px-4 py-2 bg-app border-b-2 border-cardb pt-[max(0.5rem,env(safe-area-inset-top))]">
        <span className="font-black text-t1">{tab === "study" ? "학습하기" : TABS.find(([t]) => t === tab)?.[1]}</span>{stats}
      </header>
      <main className={`flex-1 ${typing ? "" : "pb-24"} md:pb-6`}>
        {tab === "study" && <Trainer key={key} kind={launch} onChanged={refresh} onRestart={() => void startWeak()} onGoRoadmap={() => setTab("roadmap")} onGoNotes={() => setTab("wrong")} />}
        {tab === "wrong" && <WrongNotes onWeak={() => void startWeak()} onReview={(s) => void startWeak(s)} />}
        {tab === "done" && <Completed onChanged={refresh} onOpenChapter={() => void goStudy()} />}
        {tab === "practice" && <Practice onChanged={refresh} onGoRoadmap={() => setTab("roadmap")} />}
        {tab === "roadmap" && <Roadmap onStudy={() => void goStudy()} />}
      </main>
      <nav className={`md:hidden fixed bottom-0 left-0 right-0 z-30 bg-app border-t-2 border-cardb pb-[env(safe-area-inset-bottom)] ${typing ? "hidden" : "grid"} grid-cols-4`}>
        {TABS.map(([t, l, i]) => <button key={t} onClick={() => select(t)} className={`relative py-2 flex flex-col items-center gap-0.5 text-[11px] font-bold ${active === t ? "text-sky" : "text-t3"}`}><span className="text-lg leading-none">{i}</span>{l.replace("챕터 ", "")}{t === "wrong" && h && h.wrongCount > 0 && <span className="absolute top-1 right-[22%] min-w-4 h-4 px-1 rounded-full bg-red text-white text-[10px] grid place-items-center">{h.wrongCount}</span>}</button>)}
      </nav>
    </div>
  );
}
export default function App() { return <ToastHost><Shell /></ToastHost>; }
