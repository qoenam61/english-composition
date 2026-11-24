"""E10 공개용 신규 문장(track='own') 생성: 패턴마다 원본과 무관한 새 회화체 문장 1개를 만든다.

실행: python3 -I tools/etl/e10_gen_own.py gen --limit 50 --pilot      (시범: 레벨·종류를 섞어 뽑음)
      python3 -I tools/etl/e10_gen_own.py gen --workers 4              (전체, 이어하기 가능)
      python3 -I tools/etl/e10_gen_own.py review --workers 4           (엄격 리뷰 — 지적된 문장은 'bad' → gen 을 다시 돌리면 재생성)
      python3 -I tools/etl/e10_gen_own.py apply                        (리뷰까지 통과한 문장을 sentence 에 track='own' 으로 반영)
      python3 -I tools/etl/e10_gen_own.py report
입력: data/personal.sqlite (pattern_master, sentence_assign, cards[chunk·structural], sentence[원본 — 피해야 할 목록으로만 사용])
출력: 같은 DB 의 own_gen 스테이징 테이블. apply 는 sentence_id 200000+ 대역, source_ref='gen-own-v1:<model>'.
원본 문장은 개인용이라 사용자 컴퓨터의 `claude` CLI 로만 보낸다. 원본 영어는 "이 문장·상황은 쓰지 말 것" 목록으로만 준다.
"""
import argparse, json, os, random, re, sqlite3, subprocess, sys, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"
WORKDIR = Path("/tmp/claude-501/gen")
ID0 = 200000
VERSION = "gen-own-v1"

GEN_PROMPT = """You are writing NEW practice material for an English-speaking app. The learner sees a casual Korean line (what they want to say) and types the English. Goal: natural SPOKEN English conversation people really say.

For EACH input item {{id, level, kind, pattern_forms, meaning, avoid}} return one object:
- en: ONE brand-new, natural, conversational English line (the learner's reply) that clearly uses the pattern. CEFR level must match `level` (A1 = very simple words; C1/C2 = richer but still spoken). Contractions are welcome. 6-18 words usually.
    * `kind` chunk: keep the chunk's words intact (grammatical inflection is fine) but put it in a NEW situation. If the chunk is itself a whole sentence/question, adapt the slot words or the surrounding situation so the line is clearly different from the input.
    * `kind` structural: use the sentence structure with completely new content words.
    * Never reuse or lightly rephrase anything in `avoid` (those are existing sentences). Different topic, people and situation.
    * No dictionary-style, bookish or textbook sentences. Prefer what a real person would say to a friend, coworker, family member, shop clerk, etc.
- ko: how a native Korean speaker would naturally SAY this (해요체 or 반말 to match the scene). Spoken Korean, not translationese. Must carry exactly the same information as `en` (tense, negation, numbers, who). If who matters (he/she/they), the context must make it clear.
- context: the line before the learner's turn, in English. If `ko` is a statement: "Q: <the other person's natural line that leads to this reply>" — it must not give away the key words of `en`. If `ko` is a question: "(<one short situation sentence in English>)".
- hint: 2-4 consecutive words copied exactly from `en` that carry the pattern.
- variants: 0-2 other natural English answers for the same Korean (casual contractions welcome). Never the same as `en`, never a different meaning.

Return ONLY a JSON array, no prose, no code fences.

Input:
{items}
"""

REVIEW_PROMPT = """You are a strict reviewer of data for an English speaking-practice app. The learner reads a casual Korean line (`ko`) after an English `context` line and types the English reply `en`. Be critical, not generous.

Each item: {{id, level, pattern, en, ko, context, hint, variants}}.
Check:
1. en_natural: `en` is natural, grammatical conversational English that a real person would say (not bookish, not odd collocation, no strange scenario) and fits CEFR `level`.
2. pattern: `en` really uses the pattern (the hint words are present and used correctly).
3. ko_natural: `ko` is natural spoken Korean (no translationese, right politeness, natural endings).
4. drift: `ko` carries exactly the information of `en` (no added/missing time, place, person, negation, tense, number).
5. flow: `context` leads naturally into the reply, is consistent in person/gender, and does not leak the key words of `en`.
6. variants: list 0-based indexes of variants that change meaning, are ungrammatical, or unnatural.
Output ONLY a JSON array, one object per id: {{"id":1,"ok":true}} or {{"id":1,"ok":false,"why":"<short>","bad_variants":[0]}}.

Input:
{items}
"""


def connect():
    con = sqlite3.connect(DB, timeout=60, check_same_thread=False)
    con.execute("""CREATE TABLE IF NOT EXISTS own_gen(pattern_id INTEGER PRIMARY KEY, status TEXT, en TEXT, ko TEXT, context TEXT,
        hint TEXT, variants TEXT, why TEXT, tries INTEGER DEFAULT 0, model TEXT, cost_usd REAL)""")
    return con


def norm(s):
    return re.sub(r"[^a-z0-9' ]", "", s.lower().replace("’", "'")).strip()


def toks(s):
    return set(norm(s).split())


def jacc(a, b):
    a, b = toks(a), toks(b)
    return len(a & b) / max(1, len(a | b))


def inputs(con, ids):
    out = []
    for pid, sk, lv in con.execute(f"SELECT pattern_id, skeleton, level FROM pattern_master WHERE pattern_id IN ({','.join('?'*len(ids))})", ids):
        cards = con.execute("""SELECT c.pattern, c.meaning, c.kind FROM sentence_assign a JOIN cards c USING(card_id)
                               WHERE a.pattern_id=? AND c.kind!='lexical' ORDER BY c.kind DESC, c.card_id LIMIT 3""", (pid,)).fetchall()
        forms = list(dict.fromkeys(c[0] for c in cards)) or [sk]
        avoid = [r[0] for r in con.execute("SELECT en FROM sentence WHERE pattern_id=? AND track='original'", (pid,))][:3]
        out.append({"id": pid, "level": lv, "kind": cards[0][2] if cards else "chunk", "pattern_forms": forms, "meaning": cards[0][1] if cards else "", "avoid": avoid})
    return out


def call(prompt, model, raw_list=False):
    err = ""
    for _ in range(2):
        p = subprocess.run(["claude", "-p", "--model", model, "--no-session-persistence", "--disable-slash-commands", "--tools", "", "--setting-sources", "",
                            "--output-format", "json", prompt], cwd=WORKDIR, capture_output=True, text=True, timeout=900)
        try:
            meta = json.loads(p.stdout)
            arr = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", meta["result"].strip()))
            if raw_list: return arr, meta.get("total_cost_usd", 0.0)  # id 없는 목록(새 패턴 생성용)
            return {int(o["id"]): o for o in arr}, meta.get("total_cost_usd", 0.0)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
    print("  배치 실패:", err, file=sys.stderr)
    return {}, 0.0


def gate(item, o):
    """자동 검증. 통과하면 정리된 dict, 아니면 (None, 사유)."""
    try:
        en, ko, ctx = str(o["en"]).strip(), str(o["ko"]).strip(), str(o["context"]).strip()
    except (KeyError, TypeError):
        return None, "필드 누락"
    hint = o.get("hint"); hint = hint.strip() if isinstance(hint, str) else ""
    if not (3 <= len(en.split()) <= 30): return None, "영어 길이"
    if not re.search(r"[가-힣]", ko) or len(ko) > 200: return None, "한국어"
    if not (ctx.startswith("Q: ") or (ctx.startswith("(") and ctx.endswith(")"))) or len(ctx) > 240: return None, "context 형식"
    if not hint or norm(hint) not in norm(en): return None, "힌트가 en 에 없음"
    if any(w in toks(ctx) for w in toks(hint) if len(w) > 3) and sum(w in toks(ctx) for w in toks(hint)) >= max(2, len(toks(hint)) - 1): return None, "context 가 힌트를 누설"
    pat = set().union(*(toks(f) for f in item["pattern_forms"])) if item["pattern_forms"] else set()
    def rest(x): return toks(x) - pat  # 패턴 자체의 단어는 겹쳐도 당연하므로 뺀 나머지로 비교
    for a in item["avoid"]:
        ra, rn = rest(a), rest(en)
        if norm(en) == norm(a) or (len(ra) >= 3 and len(ra & rn) / max(1, len(ra | rn)) >= 0.6): return None, "원본과 유사"
    variants = []
    for v in o.get("variants") or []:
        if isinstance(v, str) and 3 <= len(v) <= 200 and norm(v) != norm(en) and norm(v) not in [norm(x) for x in variants]:
            variants.append(v.strip())
    return {"en": en, "ko": ko, "context": ctx, "hint": hint, "variants": variants[:2]}, ""


def cmd_gen(a):
    WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    q = """SELECT pattern_id FROM pattern_master WHERE flag!='merge'
           AND pattern_id NOT IN (SELECT pattern_id FROM own_gen WHERE status IN ('gen','ok')) AND COALESCE((SELECT tries FROM own_gen g WHERE g.pattern_id=pattern_master.pattern_id),0) < 4"""
    ids = [r[0] for r in con.execute(q + " ORDER BY pattern_id")]
    if a.pilot:
        random.Random(7).shuffle(ids)
    ids = ids[: a.limit] if a.limit else ids
    batches = [ids[i:i + a.batch] for i in range(0, len(ids), a.batch)]
    print(f"대상 {len(ids)}패턴 / 배치 {len(batches)} / 모델 {a.model} / 병렬 {a.workers}")
    lock = threading.Lock(); tot = {"ok": 0, "bad": 0, "cost": 0.0}; fails = []

    prepared = {tuple(b): inputs(con, b) for b in batches}  # 연결은 스레드 간 공유하므로 읽기는 미리 끝낸다

    def work(b):
        items = prepared[tuple(b)]
        res, cost = call(GEN_PROMPT.format(items=json.dumps(items, ensure_ascii=False)), a.model)
        with lock:
            if not res:  # 호출 자체가 실패(한도·네트워크 등) → 시도 횟수를 쓰지 않고 건너뛴다. 연속 실패면 중단
                fails.append(1); print("  호출 실패 — 기록하지 않고 건너뜀", flush=True)
                if len(fails) >= 3: print("연속 실패 3회 — 한도 가능성. 중단", flush=True); os._exit(3)
                return
            fails.clear()
            for it in items:
                v, why = gate(it, res[it["id"]]) if it["id"] in res else (None, "응답 없음")
                tries = (con.execute("SELECT tries FROM own_gen WHERE pattern_id=?", (it["id"],)).fetchone() or (0,))[0] + 1  # 락 안
                if v:
                    con.execute("INSERT OR REPLACE INTO own_gen(pattern_id,status,en,ko,context,hint,variants,why,tries,model,cost_usd) VALUES (?,?,?,?,?,?,?,?,?,?,?)", (it["id"], "gen", v["en"], v["ko"], v["context"], v["hint"], json.dumps(v["variants"], ensure_ascii=False), None, tries, a.model, cost / len(items)))
                    tot["ok"] += 1
                else:
                    con.execute("INSERT OR REPLACE INTO own_gen(pattern_id,status,why,tries,model) VALUES (?,?,?,?,?)", (it["id"], "bad", why, tries, a.model)); tot["bad"] += 1
            con.commit(); tot["cost"] += cost
            print(f"  배치 완료: 생성 {tot['ok']} / 게이트 탈락 {tot['bad']} / ${tot['cost']:.3f}", flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, batches))


def cmd_review(a):
    WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    rows = con.execute("SELECT g.pattern_id, m.level, m.skeleton, g.en, g.ko, g.context, g.hint, g.variants FROM own_gen g JOIN pattern_master m USING(pattern_id) WHERE g.status='gen' ORDER BY g.pattern_id").fetchall()
    if a.limit: rows = rows[: a.limit]
    batches = [rows[i:i + a.batch] for i in range(0, len(rows), a.batch)]
    print(f"리뷰 대상 {len(rows)} / 배치 {len(batches)}")
    lock = threading.Lock(); tot = {"ok": 0, "bad": 0}; fails = []

    def work(b):
        items = [{"id": r[0], "level": r[1], "pattern": r[2], "en": r[3], "ko": r[4], "context": r[5], "hint": r[6], "variants": json.loads(r[7] or "[]")} for r in b]
        res, _ = call(REVIEW_PROMPT.format(items=json.dumps(items, ensure_ascii=False)), a.model)
        with lock:
            if not res:
                fails.append(1); print("  리뷰 호출 실패 — 건너뜀", flush=True)
                if len(fails) >= 3: print("연속 실패 3회 — 한도 가능성. 중단", flush=True); os._exit(3)
                return
            fails.clear()
            for r, it in zip(b, items):
                o = res.get(r[0])
                if o is None: continue  # 응답 없음 → 'gen' 으로 남겨 다음 리뷰 때 재시도
                if o.get("ok"):
                    con.execute("UPDATE own_gen SET status='ok' WHERE pattern_id=?", (r[0],)); tot["ok"] += 1
                else:
                    bv = {i for i in o.get("bad_variants") or [] if isinstance(i, int)}
                    if bv and "variant" in str(o.get("why", "")).lower():  # 변형 정답만 문제면 그것만 버리고 통과
                        keep = [v for i, v in enumerate(it["variants"]) if i not in bv]
                        con.execute("UPDATE own_gen SET status='ok', variants=? WHERE pattern_id=?", (json.dumps(keep, ensure_ascii=False), r[0])); tot["ok"] += 1
                    else:
                        con.execute("UPDATE own_gen SET status='bad', why=? WHERE pattern_id=?", (str(o.get("why", ""))[:200], r[0])); tot["bad"] += 1
            con.commit(); print(f"  리뷰 누적 통과 {tot['ok']} / 지적 {tot['bad']}", flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, batches))


TOPIC_PROMPT = """Classify each English-practice sentence into exactly ONE place/situation category: where a learner would most naturally need to say it.
Categories (use the slug):
- daily-talk: everyday life, small talk, family/friends, feelings, opinions, general chat (default when nothing else fits)
- workplace: office work, colleagues, meetings, emails, deadlines, business operations
- presentation: ONLY language a speaker uses while giving a talk, presentation, speech or formal discussion (greeting the audience, outlining the agenda, presenting data/charts, transitions, giving examples, summarizing, taking audience questions, polite disagreement). A sentence that merely talks ABOUT a news/society/science topic (politics, crime, accidents, weather, health news) is NOT presentation — use daily-talk
- interview: job interviews, resumes, applying for jobs, career/hiring/salary talk
- school: classes, studying, exams, campus, teachers, homework
- hospital: health, doctor/pharmacy visits, symptoms, body, medicine
- restaurant: eating out, ordering food/drinks, cafes, cooking talk
- shopping-service: shopping, paying, returns, banks, post office, repairs, salons and other services
- travel: trips, airports, hotels, directions, transport, sightseeing, business trips
Input items: {{id, en, ko}}. Return ONLY a JSON array [{{"id":1,"place":"<slug>"}}], no prose.

Input:
{items}
"""


def cmd_classify(a):
    """통과한 신규 문장을 9개 장소(e9.TOPICS)로 분류(own_gen.place). 이어하기 가능."""
    WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    if "place" not in [r[1] for r in con.execute("PRAGMA table_info(own_gen)")]:
        con.execute("ALTER TABLE own_gen ADD COLUMN place TEXT")
    spec = __import__("importlib.util").util.spec_from_file_location("e9", ROOT / "tools" / "etl" / "e9_lexical_chapters.py")
    e9 = __import__("importlib.util").util.module_from_spec(spec); spec.loader.exec_module(e9)
    slugs = {t[0] for t in e9.TOPICS}
    if a.reclass:  # 특정 장소로 분류된 것만 새 기준으로 다시 분류
        rows = con.execute("SELECT pattern_id, en, ko FROM own_gen WHERE status='ok' AND place=? ORDER BY pattern_id", (a.reclass,)).fetchall()
    else:
        rows = con.execute("SELECT pattern_id, en, ko FROM own_gen WHERE status='ok' AND place IS NULL ORDER BY pattern_id").fetchall()
    batches = [rows[i:i + a.batch] for i in range(0, len(rows), a.batch)]
    print(f"분류 대상 {len(rows)} / 배치 {len(batches)}")
    lock = threading.Lock(); fails = []

    def work(b):
        res, _ = call(TOPIC_PROMPT.format(items=json.dumps([{"id": r[0], "en": r[1], "ko": r[2]} for r in b], ensure_ascii=False)), a.model)
        with lock:
            if not res:
                fails.append(1); print("  분류 호출 실패 — 건너뜀", flush=True)
                if len(fails) >= 3: print("연속 실패 3회 — 한도 가능성. 중단", flush=True); os._exit(3)
                return
            fails.clear()
            for r in b:
                t = (res.get(r[0]) or {}).get("place")
                if t in slugs: con.execute("UPDATE own_gen SET place=? WHERE pattern_id=?", (t, r[0]))
            con.commit(); print("  분류 누적:", con.execute("SELECT COUNT(*) FROM own_gen WHERE place IS NOT NULL").fetchone()[0], flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, batches))


def cmd_report(_a):
    con = connect()
    print("상태:", con.execute("SELECT status, COUNT(*) FROM own_gen GROUP BY status").fetchall())
    print("미생성 패턴:", con.execute("SELECT COUNT(*) FROM pattern_master WHERE flag!='merge' AND pattern_id NOT IN (SELECT pattern_id FROM own_gen WHERE status='ok')").fetchone()[0])
    print("탈락 사유 상위:", con.execute("SELECT substr(why,1,40), COUNT(*) FROM own_gen WHERE status='bad' GROUP BY 1 ORDER BY 2 DESC LIMIT 8").fetchall())


def cmd_apply(a):
    con = connect()
    if a.append:  # 기존 문장 ID를 보존하고(사용자 기록이 ID를 가리킨다) 아직 own 문장이 없는 패턴만 뒤에 붙인다
        LIM = 300000  # e11 대역(300000+)과 겹치지 않게 own_gen 대역은 200000~299999
        have = {r[0]: r[1] for r in con.execute("SELECT pattern_id, en FROM sentence WHERE sentence_id>=? AND sentence_id<?", (ID0, LIM))}
        seen = {norm(e) for e in have.values()}
        n = (con.execute("SELECT MAX(sentence_id) FROM sentence WHERE sentence_id>=? AND sentence_id<?", (ID0, LIM)).fetchone()[0] or ID0 - 1) + 1 - ID0
        assert ID0 + n < LIM, "ID 대역 초과"
        rows = [r for r in con.execute("SELECT pattern_id,en,ko,context,hint,variants,model FROM own_gen WHERE status='ok' ORDER BY pattern_id").fetchall() if r[0] not in have]
    else:
        if con.execute("SELECT COUNT(*) FROM sentence WHERE sentence_id>=?", (ID0,)).fetchone()[0] and not a.redo:
            sys.exit("이미 own 문장이 있습니다. 다시 반영하려면 --redo (기존 문장 ID가 바뀌므로 사용자 기록이 있으면 --append)")
        con.execute("DELETE FROM sentence_answer WHERE sentence_id>=?", (ID0,)); con.execute("DELETE FROM sentence WHERE sentence_id>=?", (ID0,))
        assert con.execute("SELECT MAX(sentence_id) FROM sentence").fetchone()[0] < ID0, "ID 대역 충돌"
        seen, n = set(), 0
        rows = con.execute("SELECT pattern_id,en,ko,context,hint,variants,model FROM own_gen WHERE status='ok' ORDER BY pattern_id").fetchall()
    base = n
    for pid, en, ko, ctx, hint, variants, model in rows:
        if norm(en) in seen: continue  # 신규끼리 중복 제거
        seen.add(norm(en)); sid = ID0 + n; n += 1
        lv = con.execute("SELECT level FROM pattern_master WHERE pattern_id=?", (pid,)).fetchone()[0]
        con.execute("INSERT INTO sentence(sentence_id,pattern_id,track,en,ko,context,must_use,difficulty,source_ref,ko_original,excluded) VALUES (?,?,?,?,?,?,?,?,?,?,0)", (sid, pid, "own", en, ko, ctx, hint, lv, f"{VERSION}:{model}", None))
        con.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (sid, en, "canonical", 1))
        for v in json.loads(variants or "[]"):
            con.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (sid, v, "variant_ai", 2))
    con.commit()
    print(f"own 문장 {n - base if a.append else n}개 {'추가' if a.append else '반영'} / 패턴 {con.execute('SELECT COUNT(*) FROM pattern_master WHERE flag!=\"merge\"').fetchone()[0]}개 중")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "review", "apply", "report", "classify"])
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--pilot", action="store_true")
    ap.add_argument("--model", default="sonnet"); ap.add_argument("--batch", type=int, default=20)
    ap.add_argument("--workers", type=int, default=1); ap.add_argument("--redo", action="store_true")
    ap.add_argument("--append", action="store_true"); ap.add_argument("--reclass", default="")
    a = ap.parse_args()
    {"gen": cmd_gen, "review": cmd_review, "apply": cmd_apply, "report": cmd_report, "classify": cmd_classify}[a.cmd](a)
