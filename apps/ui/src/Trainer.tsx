import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Card as CardT, type Submit, type Summary } from "./api";
import { diffWords } from "./diff";
import { cancelSpeech, setTtsEnabled, speak, speakSequence, ttsEnabled, ttsSupported } from "./tts";
import { Badge, Btn, Card, Modal, useToast } from "./ui";

type Graded = Extract<Submit, { kind: "graded" }>;
interface Props { kind: "chapter" | "weak" | "free"; onChanged: () => void; onRestart?: () => void; onGoRoadmap: () => void; onGoNotes?: () => void }

/** 타이핑 훈련 한 세션: 학습하기·집중 공략·자유 훈련이 같은 흐름을 쓴다(진도·기록 반영 여부는 서버가 모드로 결정). */
export function Trainer({ kind, onChanged, onRestart, onGoRoadmap, onGoNotes }: Props) {
  const toast = useToast();
  const [card, setCard] = useState<CardT | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [res, setRes] = useState<(Graded & { input: string }) | null>(null);
  const [diffOn, setDiffOn] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const [hintOpen, setHintOpen] = useState(false);
  const [usedHint, setUsedHint] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [chapterDone, setChapterDone] = useState(false);
  const [left, setLeft] = useState(0);
  const [tts, setTts] = useState(ttsEnabled);
  const [timing, setTiming] = useState(false); // 카운트다운이 시작됐는지(TTS ON 이면 질문 재생이 끝난 뒤)
  const [speaking, setSpeaking] = useState(false);
  const [grading, setGrading] = useState(false);
  const ttsRef = useRef(tts); ttsRef.current = tts;
  const loadId = useRef(0);
  const startedAt = useRef(0);
  const busy = useRef(false);
  const ta = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.next();
      if (r.card) {
        const id = ++loadId.current; cancelSpeech(); setSpeaking(false);
        setCard(r.card); setInput(""); setRes(null); setHint(null); setHintOpen(false); setUsedHint(false); setChapterDone(false);
        setLeft(r.card.timeLimitSec); setTiming(false); startedAt.current = 0;
        setTimeout(() => ta.current?.focus(), 30);
        const start = () => { if (id === loadId.current) { startedAt.current = Date.now(); setTiming(true); } };
        const q = r.card.context?.startsWith("Q: ") ? r.card.context.slice(3) : "";
        if (ttsRef.current && q) { setSpeaking(true); void speak(q).then(() => { if (id === loadId.current) setSpeaking(false); start(); }); } // 재생이 끝나거나 오류·시간 초과면 그때 시작
        else start(); // TTS OFF: 카드가 보이는 즉시 시작
      } else { setCard(null); if (r.summary) setSummary(r.summary); else setChapterDone(true); }
    } catch (e) { toast(e instanceof Error ? e.message : "불러오지 못했어요", "warn"); }
    setLoading(false);
  }, [toast]);
  useEffect(() => { void load(); }, [load]);

  // 타임어택 게이지: 색만 바뀌고 강제로 끊지 않는다(시간 초과는 기록만).
  useEffect(() => {
    if (!card || res || !timing) return;
    const t = setInterval(() => setLeft(Math.max(0, card.timeLimitSec - (Date.now() - startedAt.current) / 1000)), 100);
    return () => clearInterval(t);
  }, [card, res, timing]);
  useEffect(() => () => cancelSpeech(), []); // 화면을 떠나면 재생을 멈춘다

  const submit = async () => {
    if (!card || res || busy.current || !input.trim()) return;
    busy.current = true; setGrading(true);
    try {
      const r = await api.submit(card.sentenceId, input.trim(), usedHint, startedAt.current ? Date.now() - startedAt.current : 0);
      if (r.kind === "error") { toast(r.message, "warn"); return; }
      if (r.verdict === "MINOR_TYPO") { toast("오타 같아요. 다시 입력해 보세요 (기록되지 않아요)", "info"); ta.current?.focus(); return; }
      setRes({ ...r, input: input.trim() });
      if (ttsRef.current) { const q = card.context?.startsWith("Q: ") ? card.context.slice(3) : ""; void speakSequence([...(q ? [q, 650] : []), r.answer]); } // 질문 → 간격 → 모범 정답
      if (r.patternCompleted) { toast("🎉 패턴 완료! 학습완료 노트로 이동했어요", "ok"); onChanged(); }
      if (r.chapterCompleted) toast("🏆 챕터 완료!", "ok");
    } catch (e) { toast(e instanceof Error ? e.message : "제출 실패", "warn"); }
    finally { busy.current = false; setGrading(false); }
  };
  const showHint = async () => {
    if (!card) return;
    setHintOpen((o) => !o);
    if (hint === null) { const h = await api.hint(card.sentenceId); setHint(h.hint ?? "힌트가 없어요"); }
    setUsedHint(true);
  };
  const toggleTts = () => { const on = !tts; setTts(on); setTtsEnabled(on); if (!on) setSpeaking(false); }; // OFF 면 재생 중인 음성도 즉시 중단
  const endNow = async () => { const r = await api.next(); setCard(null); setSummary(r.summary); };

  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); res ? void load() : void submit(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "/") { e.preventDefault(); void showHint(); }
      else if (e.key.toLowerCase() === "d" && res && document.activeElement?.tagName !== "TEXTAREA") setDiffOn((v) => !v);
    };
    window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f);
  });

  if (loading && !card && !summary) return <div className="py-20 text-center text-t3">불러오는 중…</div>;
  if (chapterDone) return (
    <Card className="p-8 text-center mt-6">
      <div className="text-5xl mb-3">🏆</div>
      <h2 className="text-xl font-extrabold text-t1">이 챕터를 모두 마쳤어요</h2>
      <p className="text-t3 mt-2">다음 챕터로 이어서 학습하거나 로드맵에서 골라 보세요.</p>
      <div className="mt-5 flex gap-3 justify-center flex-wrap">
        <Btn onClick={async () => { await api.open(); onChanged(); void load(); }}>다음 챕터 시작</Btn>
        <Btn tone="neutral" onClick={onGoRoadmap}>🗺️ 챕터 로드맵</Btn>
      </div>
    </Card>
  );

  const pct = card && card.board.total ? Math.round((card.board.done / card.board.total) * 100) : 0;
  const frac = card ? left / card.timeLimitSec : 0;
  const gauge = frac > 0.5 ? "bg-sky" : frac > 0.25 ? "bg-gold" : "bg-red";
  const ctxQ = card?.context?.startsWith("Q: ");
  const ctxText = card?.context ? (ctxQ ? card.context.slice(3) : card.context.replace(/^\(|\)$/g, "")) : "";
  const showDiff = !!res && !(res.verdict === "PASS" && res.by === "code"); // 로컬 정규화로 일치한 정답은 표시를 달지 않는다
  const d = res && card && showDiff ? diffWords(res.input, res.answer) : null;
  const words = input.trim() ? input.trim().split(/\s+/).length : 0;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 pt-4 pb-10">
      {card && (
        <>
          <div className="flex items-center justify-between gap-3 mb-2 text-sm">
            <span className="font-extrabold text-t1 truncate">{card.mode === "chapter" ? `${card.level} · 챕터 ${card.chapterId}` : card.level}</span>
            {ttsSupported() && <button type="button" onClick={toggleTts} aria-pressed={tts} className={`shrink-0 flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-extrabold border-b-2 ${tts ? "bg-sky text-white border-sky-d" : "bg-surface text-t3 border-app"}`}>{tts ? "🔊 음성 ON" : "🔇 음성 OFF"}</button>}
            <div className="flex items-center gap-2 shrink-0" aria-label="남은 시간">
              <div className="w-20 h-2 rounded-full bg-surface overflow-hidden"><div className={`h-full ${gauge} transition-[width] duration-100`} style={{ width: `${res ? 0 : frac * 100}%` }} /></div>
              <span className={`tabular-nums font-bold w-12 text-right ${frac <= 0.25 && !res ? "text-red" : "text-t3"}`}>{res ? "—" : speaking ? "🔊" : `${left.toFixed(1)}s`}</span>
            </div>
          </div>
          <div className="relative h-4 rounded-full bg-surface overflow-hidden mb-1" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="relative h-full rounded-full bg-green transition-[width] duration-300" style={{ width: `${Math.max(pct, 4)}%` }}>
              <div className="absolute left-2 right-2 top-[3px] h-[4px] rounded-full bg-white/30" />
            </div>
          </div>
          <div className="text-xs text-t3 mb-4">{card.board.done} / {card.board.total} 완료</div>

          <div className="flex items-center gap-2 mb-2">
            <Badge tone="purple">PATTERN {card.patternNo}</Badge>
            {card.review && <Badge tone="gold">복습</Badge>}
          </div>
          {ctxText && (
            <div className="flex items-start gap-2 mb-3">
              {ctxQ && <span className="shrink-0 w-7 h-7 rounded-full bg-sky text-white text-xs font-extrabold grid place-items-center mt-0.5">Q</span>}
              <div className={ctxQ ? "bg-card border-2 border-cardb rounded-2xl rounded-tl-sm px-4 py-2.5 text-t2" : "text-t3 italic px-1 py-1"}>{ctxText}</div>
            </div>
          )}
          <div className="text-xs font-bold text-t3 mb-1.5">내가 하고 싶은 말</div>
          <Card className="px-4 py-4 mb-3 text-left"><p className="text-lg md:text-xl font-bold text-t1 leading-snug">{card.ko}</p></Card>

          {!res ? (
            <>
              <textarea ref={ta} value={input} onChange={(e) => setInput(e.target.value)} rows={3} enterKeyHint="send" autoCapitalize="off" autoCorrect="off" spellCheck={false}
                placeholder="영어로 말해 보세요" className="w-full text-base bg-surface border-2 border-surfb focus:border-sky outline-none rounded-2xl px-4 py-3 text-t1 placeholder:text-t3 resize-none" />
              <div className="flex items-center justify-between mt-3 gap-3">
                <div className="flex items-center gap-3 text-sm text-t3">
                  {card.hintAvailable && <Btn tone="neutral" className="!py-2 !px-3 text-sm" onClick={showHint}>💡 힌트</Btn>}
                  <span>{words}단어</span>
                </div>
                <Btn disabled={!input.trim() || grading} onClick={submit} className="px-6">{grading ? "채점 중…" : "제출하기"}</Btn>
              </div>
              {hintOpen && <div className="mt-3 rounded-xl border-2 border-purple/60 bg-purple-bg px-4 py-3 text-purple font-bold">{hint ?? "…"}</div>}
              <p className="hidden md:block mt-3 text-xs text-t3">Enter 제출 · Ctrl+/ 힌트 · 힌트를 쓰면 이 문제는 완료 횟수에 세지 않아요</p>
            </>
          ) : (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <span className={`font-extrabold ${res.verdict === "PASS" ? "text-green" : res.verdict === "OK_NO_COUNT" ? "text-sky" : "text-red"}`}>{res.verdict === "PASS" ? (usedHint ? "정답 (힌트 사용)" : "정답! 🎯") : res.verdict === "OK_NO_COUNT" ? "정답이에요 (패턴은 카운트 안 돼요)" : "아쉬워요, 정답을 확인하세요"}</span>
                <button type="button" onClick={() => setDiffOn((v) => !v)} className="flex items-center gap-2 text-sm font-bold text-t2" aria-pressed={diffOn}>
                  Diff 비교 {diffOn ? "ON" : "OFF"}
                  <span className={`w-11 h-6 rounded-full p-0.5 transition-colors ${diffOn ? "bg-sky" : "bg-surfb"}`}><span className={`block w-5 h-5 rounded-full bg-white transition-transform ${diffOn ? "translate-x-5" : ""}`} /></span>
                </button>
              </div>
              <Card className="px-4 py-3"><div className="text-xs font-bold text-t3 mb-1">한글 제시문</div><p className="text-t1 font-bold">{card.ko}</p></Card>
              <Card className="px-4 py-3"><div className="text-xs font-bold text-t3 mb-1">내 입력</div>
                <p className="text-t2 leading-relaxed">{d && diffOn ? d.mine.map((t, i) => <span key={i} className={t.bad ? "text-red line-through bg-red/20 px-1 rounded" : ""}>{t.text} </span>) : res.input}</p></Card>
              <Card className="px-4 py-3 border-green/50"><div className="text-xs font-bold text-green mb-1">모범 정답</div>
                <p className="text-t1 leading-relaxed text-lg">{d && diffOn ? d.ans.map((t, i) => <span key={i} className={t.bad ? "text-green font-bold bg-green/20 px-1 rounded" : ""}>{t.text} </span>) : res.answer}</p></Card>
              <div className={`rounded-xl px-4 py-3 text-sm font-bold ${res.verdict === "FAIL" ? "bg-red/10 text-red border border-red/40" : res.verdict === "OK_NO_COUNT" ? "bg-sky/10 text-sky border border-sky/40" : "bg-green/10 text-green border border-green/40"}`}>
                💬 {res.comment ?? (res.verdict === "PASS" ? "완벽해요! 패턴을 정확히 썼어요." : "")}
                {res.verdict === "OK_NO_COUNT" && <div className="mt-1 text-xs font-medium text-t3">이 패턴은 완료에 반영되지 않아서 나중에 다시 나와요.</div>}
              </div>
              <Btn onClick={() => void load()} className="mt-1">다음 문제 ↵</Btn>
            </div>
          )}
          {kind === "free" && !res && <Btn tone="neutral" onClick={endNow} className="mt-6 w-full text-sm">훈련 종료 및 성적표 보기</Btn>}
          {kind === "free" && res && <button onClick={endNow} className="mt-4 w-full text-sm text-t3 underline">훈련 종료 및 성적표 보기</button>}
          {kind === "weak" && <button onClick={endNow} className="mt-6 w-full text-sm text-t3 underline">집중 공략 종료 및 성적표 보기</button>}
        </>
      )}
      <Modal open={!!summary} onClose={() => {}}>
        {summary && (
          <Card className="p-6 text-center">
            <div className="text-xs font-bold text-t3">{summary.kind === "weak" ? "집중 공략 성적표" : "자유 훈련 성적표"}</div>
            <div className={`mx-auto my-3 w-24 h-24 rounded-3xl grid place-items-center text-6xl font-black border-b-8 ${summary.grade === "S" ? "bg-gold border-gold-d text-app" : summary.grade === "A" ? "bg-green border-green-d" : summary.grade === "B" ? "bg-sky border-sky-d" : "bg-surface border-app text-t2"}`}>{summary.grade}</div>
            <div className="grid grid-cols-3 gap-2 my-4 text-sm">
              <div className="bg-surface rounded-xl p-3"><div className="text-t3 text-xs">연습 문장</div><div className="text-xl font-extrabold text-t1">{summary.answered}</div></div>
              <div className="bg-surface rounded-xl p-3"><div className="text-t3 text-xs">평균 속도</div><div className="text-xl font-extrabold text-t1">{(summary.avgMs / 1000).toFixed(1)}초</div></div>
              <div className="bg-surface rounded-xl p-3"><div className="text-t3 text-xs">첫 시도 정확도</div><div className="text-xl font-extrabold text-t1">{summary.firstTryPct}%</div></div>
            </div>
            {summary.patterns.length > 0 && <div className="text-left text-sm mb-4"><div className="text-xs font-bold text-t3 mb-1.5">연습한 주요 패턴</div><div className="flex flex-wrap gap-1.5">{summary.patterns.map((p) => <Badge key={p} tone="purple" className="!bg-purple-bg !text-purple !border-purple/60">{p}</Badge>)}</div></div>}
            <div className="flex flex-col gap-2">
              <Btn onClick={() => { setSummary(null); onRestart?.(); }}>🔄 다시 훈련하기</Btn>
              <Btn tone="sky" onClick={() => { setSummary(null); void api.exitPractice(); kind === "weak" && onGoNotes ? onGoNotes() : onGoRoadmap(); }}>{kind === "weak" ? "📒 오답노트로 이동" : "🗺️ 챕터 로드맵으로 이동"}</Btn>
            </div>
          </Card>
        )}
      </Modal>
    </div>
  );
}
