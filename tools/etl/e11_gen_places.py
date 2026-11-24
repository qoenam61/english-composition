"""E11 부족한 장소(면접·발표·학교)에 새 패턴 + 새 문장(track='own')을 채운다.

실행: python3 -I tools/etl/e11_gen_places.py gen --workers 2      (이어하기 가능: 이미 끝낸 (장소,하위주제)는 건너뜀)
      python3 -I tools/etl/e11_gen_places.py review --workers 2   (엄격 리뷰, 통과분만 status='ok')
      python3 -I tools/etl/e11_gen_places.py report
출력: data/personal.sqlite 의 own_new 테이블(new_id 300000+). e9_lexical_chapters.append 가 팩을 만들 때 읽어 해당 장소 로드맵에 넣는다.
패턴 로드맵(전체 패턴)에는 넣지 않는다. 호출이 연속 3회 실패하면(한도 가능성) 즉시 중단한다.
"""
import argparse, importlib.util, json, os, re, sqlite3, sys, threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("e10", ROOT / "tools" / "etl" / "e10_gen_own.py")
e10 = importlib.util.module_from_spec(spec); spec.loader.exec_module(e10)

LEVELS = ["A2", "B1", "B2", "C1"]
PLAN = {  # 장소: (레벨당 개수, 하위 주제)
    "interview": (4, ["self-introduction", "strengths and weaknesses", "work experience and achievements", "motivation for the job and the company",
                      "salary, benefits and conditions", "asking the interviewer questions", "scheduling and confirming the interview", "thank-you and follow-up after the interview",
                      "handling difficult or unexpected questions", "teamwork and conflict stories", "career goals and plans", "resume and job application",
                      "phone or video interview", "internship and new graduate job hunting"]),
    "presentation": (3, ["opening and greeting the audience", "introducing the structure and agenda", "presenting data, charts and results", "making and defending an argument",
                         "transitions between points", "handling audience questions", "disagreeing politely and debating", "summarizing and closing",
                         "talking about slides and visuals", "speaking up in meetings and discussions", "persuading and recommending", "answering criticism and rebuttals",
                         # 2026-11-24 추가: 시사 소재 대신 발표 진행 표현을 채운다
                         "starting with a hook, a story or a question", "explaining a process step by step", "comparing options and weighing pros and cons",
                         "describing trends, increases and decreases", "emphasizing key points", "giving examples and evidence", "referring back to earlier points",
                         "handling technical problems and time limits", "inviting questions and feedback", "thanking the audience and ending",
                         "online and virtual presentations", "pitching a product or an idea", "reporting progress and results at a meeting"]),
    "school": (3, ["class participation", "asking a teacher or professor for help", "assignments and deadlines", "exams and grades", "group projects",
                   "campus life and clubs", "choosing courses and majors", "study habits and plans", "library and study spaces", "school events and activities", "talking with classmates"]),
}
PROMPT = """You are creating NEW practice material for an English-speaking app about the place/situation: "{place}", sub-topic: "{sub}".
Create {n} items for EACH of the levels {levels} ({total} items in total). Each item = one reusable speaking PATTERN plus one example reply.
- pattern: a reusable spoken chunk or sentence frame of 2-6 words that people really use in this situation (e.g. "walk you through", "I'm applying for", "could you clarify"). Lowercase, no punctuation. Must appear (inflection allowed) in `en`.
- en: ONE natural conversational English line that the learner says, using the pattern, fitting this place/sub-topic. CEFR level must match (A2 simple words/short; B1 everyday; B2 richer; C1 nuanced but still spoken). Contractions welcome. 6-20 words. Each item has a different situation and different content words.
- ko: how a native Korean speaker would naturally SAY it (해요체 or 반말 to match the scene). Spoken Korean, not translationese; exactly the same information as `en`.
- context: the line before the learner's turn, in English. If `ko` is a statement: "Q: <the other person's natural line that leads to this reply>" without giving away key words of `en`. If `ko` is a question: "(<one short situation sentence in English>)".
- hint: 2-4 consecutive words copied exactly from `en` that carry the pattern.
- variants: 0-2 other natural English answers for the same Korean. Never the same as `en`, never a different meaning.
- level: one of {levels}.
Avoid these already-existing patterns: {avoid}
Return ONLY a JSON array of objects {{"level","pattern","en","ko","context","hint","variants"}}, no prose, no code fences.
"""


def connect():
    con = sqlite3.connect(e10.DB, timeout=60, check_same_thread=False)
    con.execute("""CREATE TABLE IF NOT EXISTS own_new(new_id INTEGER PRIMARY KEY, place TEXT, sub TEXT, level TEXT, pattern TEXT, en TEXT, ko TEXT,
        context TEXT, hint TEXT, variants TEXT, status TEXT, why TEXT, model TEXT)""")
    con.execute("CREATE TABLE IF NOT EXISTS own_new_done(place TEXT, sub TEXT, PRIMARY KEY(place, sub))")
    return con


def gate(o, existing_en, existing_pat, level_set):
    try:
        lv, pat, en, ko, ctx = str(o["level"]).strip(), str(o["pattern"]).strip(), str(o["en"]).strip(), str(o["ko"]).strip(), str(o["context"]).strip()
    except (KeyError, TypeError):
        return None, "필드 누락"
    hint = o.get("hint"); hint = hint.strip() if isinstance(hint, str) else ""
    if lv not in level_set: return None, "레벨"
    if not (2 <= len(pat.split()) <= 7): return None, "패턴 길이"
    if not (4 <= len(en.split()) <= 30): return None, "영어 길이"
    if not re.search(r"[가-힣]", ko) or len(ko) > 200: return None, "한국어"
    if not (ctx.startswith("Q: ") or (ctx.startswith("(") and ctx.endswith(")"))) or len(ctx) > 240: return None, "context 형식"
    if not hint or e10.norm(hint) not in e10.norm(en): return None, "힌트가 en 에 없음"
    pt = e10.toks(pat); et = e10.toks(en)
    if not pt or len(pt & et) < max(1, len(pt) - 2): return None, "패턴이 en 에 없음"
    if e10.norm(pat) in existing_pat: return None, "기존 패턴과 동일"
    if any(e10.jacc(en, x) >= 0.6 for x in existing_en): return None, "기존 문장과 유사"
    variants = []
    for v in o.get("variants") or []:
        if isinstance(v, str) and 3 <= len(v) <= 200 and e10.norm(v) != e10.norm(en) and e10.norm(v) not in [e10.norm(x) for x in variants]:
            variants.append(v.strip())
    return {"level": lv, "pattern": pat, "en": en, "ko": ko, "context": ctx, "hint": hint, "variants": variants[:2]}, ""


def cmd_gen(a):
    e10.WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    done = {(r[0], r[1]) for r in con.execute("SELECT place, sub FROM own_new_done")}
    existing_pat = {e10.norm(r[0]) for r in con.execute("SELECT skeleton FROM pattern_master")} | {e10.norm(r[0]) for r in con.execute("SELECT pattern FROM own_new")}
    existing_en = [r[0] for r in con.execute("SELECT en FROM sentence WHERE track='own'")] + [r[0] for r in con.execute("SELECT en FROM own_new")]
    jobs = [(pl, sub, n) for pl, (n, subs) in PLAN.items() for sub in subs if (pl, sub) not in done]
    if a.limit: jobs = jobs[: a.limit]
    print(f"작업 {len(jobs)}건 / 병렬 {a.workers} / 모델 {a.model}")
    lock = threading.Lock(); fails = []; tot = {"ok": 0, "bad": 0}

    def work(j):
        pl, sub, n = j
        with lock: sample = [r[0] for r in con.execute("SELECT skeleton FROM pattern_master ORDER BY random() LIMIT 25")]
        res, _ = e10.call(PROMPT.format(place=pl, sub=sub, n=n, levels=", ".join(LEVELS), total=n * len(LEVELS), avoid=json.dumps(sample, ensure_ascii=False)).replace("{{", "{").replace("}}", "}"), a.model, raw_list=True)
        with lock:
            if not res:
                fails.append(1); print("  호출 실패 — 기록하지 않고 건너뜀", flush=True)
                if len(fails) >= 3: print("연속 실패 3회 — 한도 가능성. 중단", flush=True); os._exit(3)
                return
            fails.clear()
            for o in res:
                v, why = gate(o, existing_en, existing_pat, set(LEVELS))
                if not v: tot["bad"] += 1; continue
                nid = (con.execute("SELECT MAX(new_id) FROM own_new").fetchone()[0] or 299999) + 1
                con.execute("INSERT INTO own_new VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", (nid, pl, sub, v["level"], v["pattern"], v["en"], v["ko"], v["context"], v["hint"], json.dumps(v["variants"], ensure_ascii=False), "gen", None, a.model))
                existing_pat.add(e10.norm(v["pattern"])); existing_en.append(v["en"]); tot["ok"] += 1
            con.execute("INSERT OR REPLACE INTO own_new_done VALUES (?,?)", (pl, sub)); con.commit()
            print(f"  {pl} / {sub}: 누적 생성 {tot['ok']} / 게이트 탈락 {tot['bad']}", flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, jobs))


def cmd_review(a):
    e10.WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    rows = con.execute("SELECT new_id, level, pattern, en, ko, context, hint, variants FROM own_new WHERE status='gen' ORDER BY new_id").fetchall()
    batches = [rows[i:i + a.batch] for i in range(0, len(rows), a.batch)]
    print(f"리뷰 대상 {len(rows)} / 배치 {len(batches)}")
    lock = threading.Lock(); fails = []; tot = {"ok": 0, "bad": 0}

    def work(b):
        items = [{"id": r[0], "level": r[1], "pattern": r[2], "en": r[3], "ko": r[4], "context": r[5], "hint": r[6], "variants": json.loads(r[7] or "[]")} for r in b]
        res, _ = e10.call(e10.REVIEW_PROMPT.format(items=json.dumps(items, ensure_ascii=False)), a.model)
        with lock:
            if not res:
                fails.append(1); print("  리뷰 호출 실패 — 건너뜀", flush=True)
                if len(fails) >= 3: print("연속 실패 3회 — 한도 가능성. 중단", flush=True); os._exit(3)
                return
            fails.clear()
            for r, it in zip(b, items):
                o = res.get(r[0])
                if o is None: continue
                if o.get("ok"):
                    con.execute("UPDATE own_new SET status='ok' WHERE new_id=?", (r[0],)); tot["ok"] += 1
                else:
                    bv = {i for i in o.get("bad_variants") or [] if isinstance(i, int)}
                    if bv and "variant" in str(o.get("why", "")).lower():
                        keep = [v for i, v in enumerate(it["variants"]) if i not in bv]
                        con.execute("UPDATE own_new SET status='ok', variants=? WHERE new_id=?", (json.dumps(keep, ensure_ascii=False), r[0])); tot["ok"] += 1
                    else:
                        con.execute("UPDATE own_new SET status='bad', why=? WHERE new_id=?", (str(o.get("why", ""))[:200], r[0])); tot["bad"] += 1
            con.commit(); print(f"  리뷰 누적 통과 {tot['ok']} / 지적 {tot['bad']}", flush=True)

    with ThreadPoolExecutor(a.workers) as ex:
        list(ex.map(work, batches))


def cmd_report(_a):
    con = connect()
    print("상태:", con.execute("SELECT status, COUNT(*) FROM own_new GROUP BY status").fetchall())
    print("장소·레벨(통과):", con.execute("SELECT place, level, COUNT(*) FROM own_new WHERE status='ok' GROUP BY 1,2 ORDER BY 1,2").fetchall())
    print("끝낸 하위주제:", con.execute("SELECT COUNT(*) FROM own_new_done").fetchone()[0], "/", sum(len(s) for _, s in PLAN.values()))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["gen", "review", "report"])
    ap.add_argument("--limit", type=int, default=0); ap.add_argument("--model", default="sonnet")
    ap.add_argument("--batch", type=int, default=30); ap.add_argument("--workers", type=int, default=1)
    a = ap.parse_args()
    {"gen": cmd_gen, "review": cmd_review, "report": cmd_report}[a.cmd](a)
