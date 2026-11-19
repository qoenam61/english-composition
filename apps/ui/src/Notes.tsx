import { useEffect, useState } from "react";
import { api, type ErrType, type Notes, type Stats, type Overview } from "./api";
import { diffWords } from "./diff";
import { Badge, Btn, Card, fmtDate, PAGE_SIZE, Pager, useToast } from "./ui";

const TYPE: Record<ErrType, { label: string; color: string }> = {
  pattern_order: { label: "패턴/어순", color: "#CE82FF" }, article_prep: { label: "관사/전치사", color: "#FF9600" },
  vocab: { label: "어휘 선택", color: "#1CB0F6" }, tense: { label: "시제/수일치", color: "#FF86D0" },
};

export function WrongNotes({ onWeak, onReview }: { onWeak: () => void; onReview: (sentenceId: number) => void }) {
  const [n, setN] = useState<Notes | null>(null); const [page, setPage] = useState(0);
  useEffect(() => { void api.notes().then(setN); }, []);
  if (!n) return <div className="py-20 text-center text-t3">불러오는 중…</div>;
  const pages = Math.ceil(n.wrong.length / PAGE_SIZE); const cur = Math.min(page, Math.max(pages - 1, 0));
  const total = Object.values(n.typeCount).reduce((a, b) => a + (b ?? 0), 0);
  if (n.wrong.length === 0) return <div className="max-w-2xl mx-auto px-4 py-16 text-center"><div className="text-5xl mb-3">✨</div><p className="text-t2 font-bold">오답노트가 비어 있어요</p><p className="text-t3 text-sm mt-1">틀린 문장이 생기면 여기에 쌓여요.</p></div>;
  return (
    <div className="max-w-2xl mx-auto px-4 py-5 flex flex-col gap-4">
      <Card className="p-4">
        <h2 className="font-extrabold text-t1 mb-3">오답 분석 상황판</h2>
        <div className="flex h-5 rounded-full overflow-hidden bg-surface" role="img" aria-label="오류 유형 비율">
          {(Object.keys(TYPE) as ErrType[]).map((k) => (n.typeCount[k] ?? 0) > 0 && <div key={k} style={{ width: `${((n.typeCount[k] ?? 0) / total) * 100}%`, background: TYPE[k].color }} />)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-t2">
          {(Object.keys(TYPE) as ErrType[]).map((k) => <span key={k} className="flex items-center gap-1.5"><i className="w-2.5 h-2.5 rounded-sm" style={{ background: TYPE[k].color }} />{TYPE[k].label} {total ? Math.round(((n.typeCount[k] ?? 0) / total) * 100) : 0}%</span>)}
        </div>
        <p className="text-[11px] text-t3 mt-2">오류 유형은 단어 비교로 추정한 값이라 틀릴 수 있어요.</p>
        <div className="mt-4 text-xs font-bold text-t3 mb-2">가장 많이 틀린 패턴 TOP 3</div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {n.top3.map((t, i) => <div key={t.patternId} className="bg-surface rounded-xl p-3 border-2 border-surfb"><div className="text-xs text-t3">#{i + 1} · {t.wrongCount}회</div><div className="font-bold text-purple text-sm break-words">{t.template || `패턴 ${t.patternId}`}</div></div>)}
        </div>
        <Btn tone="orange" onClick={onWeak} className="w-full mt-4">🔥 상위 오답 5개 연속 집중 공략</Btn>
      </Card>
      <div className="text-xs text-t3 -mb-2">총 {n.wrong.length}개 · {cur * PAGE_SIZE + 1}–{Math.min((cur + 1) * PAGE_SIZE, n.wrong.length)}번째</div>
      {n.wrong.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE).map((w) => {
        const d = diffWords(w.lastWrongInput, w.answer);
        return (
          <Card key={w.patternId + ":" + w.sentenceId} className="p-4">
            <div className="flex items-center gap-2 flex-wrap mb-2">
              <Badge tone="red">{w.wrongCount}회 오답</Badge>
              <span className="text-xs font-extrabold rounded-lg px-2 py-0.5" style={{ background: TYPE[w.error.type].color + "33", color: TYPE[w.error.type].color }}>{w.error.label}</span>
              <span className="text-[11px] text-t3 ml-auto">{fmtDate(w.lastWrongAt)}</span>
            </div>
            <p className="font-bold text-t1">{w.ko}</p>
            <p className="text-green font-bold mt-1">{w.answer}</p>
            <div className="mt-3 rounded-xl bg-surface p-3 text-sm">
              <div className="text-xs font-bold text-t3 mb-1">내 오답 패턴 분석</div>
              <p className="text-t2">{d.mine.map((t, i) => <span key={i} className={t.bad ? "text-red line-through bg-red/20 px-1 rounded" : ""}>{t.text} </span>)}</p>
              <p className="text-t3 mt-1.5">{w.error.comment}</p>
            </div>
            {w.template && <div className="mt-3 rounded-xl border-l-4 border-purple bg-purple-bg px-3 py-2 text-sm"><div className="text-xs font-bold text-purple mb-0.5">패턴 핵심 이해</div><span className="text-t2">핵심 표현 <b className="text-purple">{w.template}</b> 을(를) 덩어리째 말해 보세요.</span></div>}
            <Btn tone="sky" onClick={() => onReview(w.sentenceId)} className="w-full mt-3 text-sm">이 문장 바로 복습하기</Btn>
          </Card>
        );
      })}
      <Pager page={cur} pages={pages} onPage={setPage} />
    </div>
  );
}

function longestStreak(days: Array<{ date: string }>): number {
  const ts = days.map((d) => Date.parse(d.date + "T00:00:00Z")).sort((a, b) => a - b);
  let best = 0, run = 0;
  ts.forEach((t, i) => { run = i > 0 && t - ts[i - 1]! === 86_400_000 ? run + 1 : 1; best = Math.max(best, run); });
  return best;
}

export function Completed({ onChanged, onOpenChapter }: { onChanged: () => void; onOpenChapter: () => void }) {
  const toast = useToast();
  const [page, setPage] = useState(0);
  const [n, setN] = useState<Notes | null>(null); const [st, setSt] = useState<Stats | null>(null); const [ov, setOv] = useState<Overview | null>(null);
  const load = () => { void api.notes().then(setN); void api.stats().then(setSt); void api.overview().then(setOv); };
  useEffect(load, []);
  if (!n || !st || !ov) return <div className="py-20 text-center text-t3">불러오는 중…</div>;
  const undo = async (id: number) => { await api.uncomplete(id); toast("학습 대기열로 되돌렸어요", "info"); onChanged(); load(); };
  const pages = Math.ceil(n.completed.length / PAGE_SIZE); const cur = Math.min(page, Math.max(pages - 1, 0));
  const rate = ov.totalPatterns ? Math.round((ov.totalDone / ov.totalPatterns) * 1000) / 10 : 0;
  const stat = (label: string, value: string) => <div className="rounded-2xl border-2 border-gold/60 bg-gold/10 p-3 text-center"><div className="text-[11px] font-bold text-gold">{label}</div><div className="text-xl md:text-2xl font-black text-gold mt-0.5">{value}</div></div>;
  return (
    <div className="max-w-2xl mx-auto px-4 py-5 flex flex-col gap-4">
      <div className="grid grid-cols-3 gap-2">{stat("총 마스터 문장", `${n.completed.length}개`)}{stat("커리큘럼 달성률", `${rate}%`)}{stat("최고 연속 학습일", `${longestStreak(st.days)}일`)}</div>
      {n.completed.length === 0 && <div className="py-12 text-center text-t3">아직 완료한 패턴이 없어요. 한 패턴을 두 번 연속 맞히면 여기로 와요.</div>}
      {n.completed.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE).map((c) => (
        <Card key={c.patternId} className="p-4">
          <div className="flex items-center gap-2 mb-2"><Badge tone="gold">🏅 MASTERED</Badge><span className="text-[11px] text-t3 ml-auto">{fmtDate(c.completedAt)}</span></div>
          <p className="font-bold text-t1">{c.ko}</p><p className="text-green font-bold mt-1">{c.en}</p>
          <Btn tone="neutral" onClick={() => void undo(c.patternId)} className="w-full mt-3 text-sm">완료 취소 (다시 학습에 추가)</Btn>
        </Card>
      ))}
      <Pager page={cur} pages={pages} onPage={setPage} />
      {n.completed.length > 0 && <button onClick={onOpenChapter} className="text-xs text-t3 underline text-center">되돌린 패턴은 해당 챕터에서 다시 나와요</button>}
    </div>
  );
}
