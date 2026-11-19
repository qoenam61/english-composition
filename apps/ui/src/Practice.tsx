import { useState } from "react";
import { api } from "./api";
import { Trainer } from "./Trainer";
import { Btn, Card, useToast } from "./ui";

const LEVELS = [["all", "전체"], ["A1", "A1"], ["A2", "A2"], ["B1", "B1"]] as const;

/** 자유 훈련: 오답노트·진도·통계 어디에도 기록하지 않는 샌드박스. */
export function Practice({ onGoRoadmap, onChanged }: { onGoRoadmap: () => void; onChanged: () => void }) {
  const toast = useToast();
  const [level, setLevel] = useState<string>("all"); const [run, setRun] = useState(0);
  const start = async () => {
    const r = await api.practice("free", { level, n: 10 });
    if (!r.ok) { toast(r.reason, "warn"); return; }
    setRun((k) => k + 1);
  };
  if (run > 0) return <Trainer key={run} kind="free" onChanged={onChanged} onRestart={() => void start()} onGoRoadmap={() => { setRun(0); onGoRoadmap(); }} />;
  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <Card className="p-6">
        <h2 className="text-xl font-extrabold text-t1">자유 훈련</h2>
        <p className="text-t3 text-sm mt-1">기록 부담 없이 속도를 시험해요. 오답노트·진도·통계에는 남지 않아요.</p>
        <div className="mt-5 text-xs font-bold text-t3 mb-2">난이도</div>
        <div className="flex gap-2 flex-wrap">{LEVELS.map(([v, l]) => <button key={v} onClick={() => setLevel(v)} className={`px-4 py-2 rounded-xl font-bold border-b-4 ${level === v ? "bg-sky border-sky-d text-white" : "bg-surface border-app text-t2"}`}>{l}</button>)}</div>
        <Btn onClick={() => void start()} className="w-full mt-6">10문제 시작</Btn>
      </Card>
    </div>
  );
}
