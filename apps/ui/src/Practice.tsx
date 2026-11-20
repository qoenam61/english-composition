import { useEffect, useState } from "react";
import { api, type Roadmap } from "./api";
import { Trainer } from "./Trainer";
import { Btn, Card, useToast } from "./ui";

const LEVELS = [["all", "전체"], ["A1", "A1"], ["A2", "A2"], ["B1", "B1"], ["B2", "B2"], ["C1", "C1"], ["C2", "C2"]] as const;

/** 자유 훈련: 오답노트·진도·통계 어디에도 기록하지 않는 샌드박스. */
export function Practice({ onGoRoadmap, onChanged }: { onGoRoadmap: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [level, setLevel] = useState<string>("all"); const [run, setRun] = useState(0);
  const [maps, setMaps] = useState<Roadmap[]>([]); const [topic, setTopic] = useState<string>("pattern");
  useEffect(() => { void api.roadmaps().then(setMaps).catch(() => {}); }, []);
  const start = async () => {
    const r = await api.practice("free", { level, n: 10, roadmap: topic });
    if (!r.ok) { toast(r.reason, "warn"); return; }
    setRun((k) => k + 1);
  };
  if (run > 0) return <Trainer key={run} kind="free" onChanged={onChanged} onRestart={() => void start()} onGoRoadmap={() => { setRun(0); onGoRoadmap(); }} />;
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card className="p-6">
        <h2 className="text-xl font-extrabold text-t1">자유 훈련</h2>
        <p className="text-t3 text-sm mt-1">기록 부담 없이 속도를 시험해요. 오답노트·진도·통계에는 남지 않아요.</p>
        {maps.length > 1 && <>
          <div className="mt-5 text-xs font-bold text-t3 mb-2">주제</div>
          <select value={topic} onChange={(e) => setTopic(e.target.value)} aria-label="주제 선택" className="w-full px-3 py-2.5 rounded-xl bg-surface text-t1 font-extrabold border-2 border-cardb">
            {maps.map((x, i) => <option key={x.id} value={x.id}>{i === 0 ? "★ 패턴 학습" : x.label}</option>)}
          </select>
        </>}
        <div className="mt-5 text-xs font-bold text-t3 mb-2">난이도</div>
        <div className="flex gap-2 flex-wrap">{LEVELS.map(([v, l]) => <button key={v} onClick={() => setLevel(v)} className={`px-4 py-2 rounded-xl font-bold border-b-4 ${level === v ? "bg-sky border-sky-d text-white" : "bg-surface border-app text-t2"}`}>{l}</button>)}</div>
        <Btn onClick={() => void start()} className="w-full mt-6">10문제 시작</Btn>
      </Card>
    </div>
  );
}
