"""E8 검수: 생성된 회화체 데이터(한국어·앞 대사·변형 정답)를 생성과 다른 엄격한 기준으로 한 번 더 점검하고 고친다.

실행: python3 -I tools/etl/e8_review.py --workers 4 --model sonnet     (전체 검수, 이어하기 가능)
      python3 -I tools/etl/e8_review.py --apply                         (검수 수정을 sentence_gen 에 반영)
      python3 -I tools/etl/e8_review.py --report                        (집계 리포트)
점검 항목: 한국어 자연스러움 / 영어와의 의미 일치 / 앞 대사→답변 흐름 / 영어 답의 자연스러움 / 변형 정답의 타당성
추가 측정: 원본 한국어(ko_original)가 어색한지 — 생성본이 원본 수준 이상인지 비교하기 위함.
"""
import argparse
import json
import re
import subprocess
import sys
import threading
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import importlib.util  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent.parent
spec = importlib.util.spec_from_file_location("g", ROOT / "tools" / "etl" / "e8_generate.py")
g = importlib.util.module_from_spec(spec)
spec.loader.exec_module(g)

PROMPT = """You are a strict reviewer of data for an English speaking-practice app. The learner reads a casual Korean line (`ko`), after an English `context` line, and types the English reply `en`. Review each item independently and critically. Do not be generous.

Each input item: {{id, en, ko_original, ko, context, variants}}.

Check:
1. ko_awkward: `ko` must sound like natural SPOKEN Korean that a native would say in this exchange (no stiff written style, no translationese, right politeness level, natural particles/endings).
2. drift: `ko` must carry the same information as `en`. Added or missing facts (time, place, means, reported speech such as "~대요", numbers, who, negation, tense) count as drift.
3. flow: `context` must lead naturally into the reply (`en`), be coherent, not give away the reply's key words, and keep person/gender/number consistent with `en` and `ko`. "(...)" contexts are situation notes; "Q: ..." is the other person's line.
4. en_awkward: `en` itself is unnatural, ungrammatical or too bookish for conversation.
5. variants: list the 0-based indexes of variants that change the meaning of `ko`, are ungrammatical, or unnatural.
Also report oa: true if `ko_original` itself sounds awkward/stiff/translationese as spoken Korean (independent of `ko`).

Output ONLY a JSON array with one object per input id, in order:
- no issues: {{"id":1,"ok":true,"oa":false}}
- issues: {{"id":1,"issues":["ko_awkward","drift","flow","en_awkward","variant"],"ko":"<corrected Korean or null>","context":"<corrected context or null>","drop":[0],"note":"<=15 words","oa":false}}
When you correct `ko`, keep it natural spoken Korean with exactly the information in `en`. When you correct `context`, keep the format ("Q: ..." or "(...)"). Never change `en`.

Input:
{items}
"""


def connect():
    con = g.connect()
    con.execute("""CREATE TABLE IF NOT EXISTS sentence_review(
        sentence_id INTEGER PRIMARY KEY, issues TEXT, ko_fix TEXT, ctx_fix TEXT, drop_idx TEXT, note TEXT,
        orig_awkward INTEGER, model TEXT, applied INTEGER DEFAULT 0)""")
    return con


def pick(con, limit):
    q = """SELECT s.sentence_id, s.en, s.ko_original, x.ko, x.context, x.variants
           FROM sentence_gen x JOIN sentence s USING(sentence_id)
           WHERE s.sentence_id NOT IN (SELECT sentence_id FROM sentence_review)
           ORDER BY s.sentence_id"""
    if limit:
        q += f" LIMIT {int(limit)}"
    return con.execute(q).fetchall()


def clean_fix(o, rowmap):
    """검수 결과를 검증·정리한다."""
    ko_fix = o.get("ko") if isinstance(o.get("ko"), str) else None
    if ko_fix:
        ko_fix = ko_fix.strip()
        if not re.search(r"[가-힣]", ko_fix) or len(ko_fix) > 200:
            ko_fix = None
    cx = o.get("context") if isinstance(o.get("context"), str) else None
    if cx:
        cx = cx.strip()
        if not (cx.startswith("Q: ") or (cx.startswith("(") and cx.endswith(")"))) or len(cx) > 240:
            cx = None
    drop = [i for i in (o.get("drop") or []) if isinstance(i, int) and i >= 0]
    issues = [x for x in (o.get("issues") or []) if x in ("ko_awkward", "drift", "flow", "en_awkward", "variant")]
    return issues, ko_fix, cx, drop, str(o.get("note") or "")[:120]


def run_batch(rows, model):
    items = [{"id": r[0], "en": r[1], "ko_original": r[2], "ko": r[3], "context": r[4], "variants": json.loads(r[5] or "[]")} for r in rows]
    prompt = PROMPT.format(items=json.dumps(items, ensure_ascii=False))
    err = ""
    for _ in (1, 2):
        p = subprocess.run(["claude", "-p", "--model", model, "--no-session-persistence", "--disable-slash-commands",
                            "--tools", "", "--setting-sources", "", "--output-format", "json", prompt],
                           cwd=g.WORKDIR, capture_output=True, text=True, timeout=900)
        try:
            meta = json.loads(p.stdout)
            arr = json.loads(re.sub(r"^```(?:json)?\s*|\s*```$", "", meta["result"].strip()))
            by = {int(o["id"]): o for o in arr}
            return by, meta.get("total_cost_usd", 0.0)
        except Exception as e:  # noqa: BLE001
            err = f"{type(e).__name__}: {e}"
    print("  배치 실패:", err, file=sys.stderr)
    return {}, 0.0


def review(args):
    g.WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    rows = pick(con, args.limit)
    batches = [rows[i:i + args.batch] for i in range(0, len(rows), args.batch)]
    print(f"검수 대상 {len(rows)}문장 / 배치 {len(batches)}개 / 모델 {args.model} / 병렬 {args.workers}")
    lock = threading.Lock()
    tot = {"done": 0, "bad": 0, "cost": 0.0}

    def work(b):
        by, cost = run_batch(b, args.model)
        with lock:
            for r in b:
                o = by.get(r[0])
                if o is None:
                    tot["bad"] += 1
                    continue
                issues, ko_fix, cx, drop, note = clean_fix(o, None)
                if o.get("ok") is True:
                    issues = []
                con.execute("INSERT OR REPLACE INTO sentence_review VALUES (?,?,?,?,?,?,?,?,0)",
                            (r[0], json.dumps(issues), ko_fix, cx, json.dumps(drop), note, int(bool(o.get("oa"))), args.model))
                tot["done"] += 1
            con.commit()
            tot["cost"] += cost
            print(f"  완료 {tot['done']} / 실패 {tot['bad']} / ${tot['cost']:.2f}")

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(work, batches))
    print(f"검수 저장 {tot['done']} / 실패 {tot['bad']} / ${tot['cost']:.2f}")


def apply(_a):
    """검수 수정을 sentence_gen 에 반영한다(고친 뒤에는 e8_generate.py --apply 와 e7 로 팩을 다시 만든다)."""
    con = connect()
    n = Counter()
    for sid, issues, ko_fix, ctx_fix, drop, _note in con.execute(
            "SELECT sentence_id, issues, ko_fix, ctx_fix, drop_idx, note FROM sentence_review WHERE applied=0 AND issues!='[]'").fetchall():
        row = con.execute("SELECT ko, context, variants FROM sentence_gen WHERE sentence_id=?", (sid,)).fetchone()
        if not row:
            continue
        ko, cx, variants = row
        iss = json.loads(issues)
        if ko_fix and ({"ko_awkward", "drift"} & set(iss)):
            ko = ko_fix
            n["ko"] += 1
        if ctx_fix and "flow" in iss:
            cx = ctx_fix
            n["context"] += 1
        vs = json.loads(variants or "[]")
        dr = set(json.loads(drop or "[]"))
        if dr:
            n["variants_dropped"] += len([i for i in dr if i < len(vs)])
            vs = [v for i, v in enumerate(vs) if i not in dr]
        con.execute("UPDATE sentence_gen SET ko=?, context=?, variants=? WHERE sentence_id=?", (ko, cx, json.dumps(vs, ensure_ascii=False), sid))
        con.execute("UPDATE sentence_review SET applied=1 WHERE sentence_id=?", (sid,))
    con.commit()
    print("반영:", dict(n))


def report(_a):
    con = connect()
    tot = con.execute("SELECT COUNT(*) FROM sentence_review").fetchone()[0]
    c = Counter()
    for (iss,) in con.execute("SELECT issues FROM sentence_review"):
        l = json.loads(iss)
        c["문제 있음"] += bool(l)
        for k in l:
            c[k] += 1
    oa = con.execute("SELECT SUM(orig_awkward) FROM sentence_review").fetchone()[0] or 0
    print(f"검수 {tot}문장")
    for k, v in c.most_common():
        print(f"  {k}: {v} ({v / tot:.1%})")
    print(f"  원본 한국어가 어색: {oa} ({oa / tot:.1%})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--batch", type=int, default=40)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--report", action="store_true")
    a = ap.parse_args()
    apply(a) if a.apply else report(a) if a.report else review(a)
