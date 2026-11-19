"""E8 생성: 문장별 회화체 한국어·앞 대사(context)·힌트·변형 정답을 LLM(`claude -p`)으로 배치 생성한다.

실행: python3 -I tools/etl/e8_generate.py --limit 25 --model sonnet --workers 1        (시범)
      python3 -I tools/etl/e8_generate.py --chapters 2-10 --workers 4                  (범위 지정)
      python3 -I tools/etl/e8_generate.py --apply                                      (생성 결과를 sentence 에 반영)
입력: data/personal.sqlite (sentence, pattern_master, chapter_pattern)
출력: 같은 DB 의 `sentence_gen` 테이블(재실행 시 이미 처리한 문장은 건너뜀 = 이어하기 가능)

원본 문장은 개인용 데이터라 이 스크립트는 사용자 본인 컴퓨터의 `claude` CLI 로만 보낸다. 결과 JSON 은 커밋하지 않는다(data/ 는 git 제외).
"""
import argparse
import json
import re
import sqlite3
import subprocess
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"
WORKDIR = Path("/tmp/claude-501/gen")  # 프로젝트 지침이 로드되지 않는 빈 디렉터리

PROMPT = """You are building data for an English-speaking practice app. The learner sees a casual Korean line (what they want to say) and types the English. The goal is natural spoken English conversation, not translation drills.

For EACH input item {{id, pattern, ko, en}} return one object:
- id: same id.
- keep: true unless the English line is truly unusable (meaningless, or clearly does not contain the pattern idea). Dry factual or encyclopedic lines should still be kept: invent a natural conversational setting for them.
- ko: rewrite the Korean as natural SPOKEN Korean (해요체 or 반말, matching the conversation), the way a native speaker would actually say it. It MUST keep exactly the same meaning as `en` (tense, negation, numbers, who does what). Do not drop information that would make `en` ambiguous (if she/he/they matters, make the context say who).
- context: the line before the learner's turn, in English.
    * If `ko` is a statement: "Q: <the other person's natural line that leads to this reply>". It must not leak the answer's key words.
    * If `ko` is itself a question: "(<one short situation sentence in English>)".
- hint: 2-4 consecutive words copied exactly from `en` that carry the pattern (null if none).
- variants: 0-2 other natural English answers a learner could give for the same Korean (casual contractions welcome). Never repeat `en` or change its meaning.

Return ONLY a JSON array, no prose, no code fences.

Input:
{items}
"""


def connect() -> sqlite3.Connection:
    con = sqlite3.connect(DB, timeout=60, check_same_thread=False)
    con.execute("""CREATE TABLE IF NOT EXISTS sentence_gen(
        sentence_id INTEGER PRIMARY KEY, keep INTEGER, ko TEXT, context TEXT, hint TEXT, variants TEXT,
        model TEXT, cost_usd REAL, out_tokens INTEGER)""")
    return con


def pick(con, chapters, limit):
    q = """SELECT s.sentence_id, m.skeleton, s.ko, s.en, cp.chapter_id
           FROM sentence s JOIN pattern_master m ON m.pattern_id=s.pattern_id
           JOIN chapter_pattern cp ON cp.pattern_id=s.pattern_id
           WHERE s.sentence_id NOT IN (SELECT sentence_id FROM sentence_gen)"""
    args = []
    if chapters:
        q += " AND cp.chapter_id BETWEEN ? AND ?"
        args += list(chapters)
    q += " ORDER BY cp.chapter_id, cp.rowid, s.sentence_id"
    if limit:
        q += " LIMIT ?"
        args.append(limit)
    return con.execute(q, args).fetchall()


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9' ]", "", s.lower().replace("’", "'"))


def validate(item, src):
    """생성 결과 한 건을 검증해 정리한다. 실패하면 None."""
    try:
        keep = bool(item["keep"])
        ko = str(item["ko"]).strip()
        ctx = str(item["context"]).strip()
    except (KeyError, TypeError):
        return None
    if not re.search(r"[가-힣]", ko) or len(ko) > 200:
        return None
    if not (ctx.startswith("Q: ") or (ctx.startswith("(") and ctx.endswith(")"))) or len(ctx) > 240:
        return None
    hint = item.get("hint")
    hint = hint.strip() if isinstance(hint, str) else None
    if hint and norm(hint) not in norm(src["en"]):
        hint = None  # 정답에 실제로 없는 힌트는 버린다
    variants = []
    for v in item.get("variants") or []:
        if isinstance(v, str) and 3 <= len(v) <= 200 and norm(v) != norm(src["en"]) and norm(v) not in [norm(x) for x in variants]:
            variants.append(v.strip())
    return {"keep": keep, "ko": ko, "context": ctx, "hint": hint, "variants": variants[:2]}


def run_batch(rows, model):
    items = [{"id": r[0], "pattern": r[1], "ko": r[2], "en": r[3]} for r in rows]
    prompt = PROMPT.format(items=json.dumps(items, ensure_ascii=False))
    for attempt in (1, 2):
        p = subprocess.run(
            ["claude", "-p", "--model", model, "--no-session-persistence", "--disable-slash-commands",
             "--tools", "", "--setting-sources", "", "--output-format", "json", prompt],
            cwd=WORKDIR, capture_output=True, text=True, timeout=600)
        try:
            meta = json.loads(p.stdout)
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", meta["result"].strip())
            arr = json.loads(text)
            by = {int(o["id"]): o for o in arr}
            out = {}
            for r in rows:
                v = validate(by.get(r[0]) or {}, {"en": r[3]})
                if v:
                    out[r[0]] = v
            return out, meta.get("total_cost_usd", 0.0), (meta.get("usage") or {}).get("output_tokens", 0)
        except Exception as e:  # noqa: BLE001 — 파싱 실패는 한 번 재시도
            err = f"{type(e).__name__}: {e}"
    print("  배치 실패:", err, file=sys.stderr)
    return {}, 0.0, 0


def generate(args):
    WORKDIR.mkdir(parents=True, exist_ok=True)
    con = connect()
    chapters = tuple(int(x) for x in args.chapters.split("-")) if args.chapters else None
    if chapters and len(chapters) == 1:
        chapters = (chapters[0], chapters[0])
    rows = pick(con, chapters, args.limit)
    batches = [rows[i:i + args.batch] for i in range(0, len(rows), args.batch)]
    print(f"대상 {len(rows)}문장 / 배치 {len(batches)}개 / 모델 {args.model} / 병렬 {args.workers}")
    lock = threading.Lock()
    tot = {"ok": 0, "drop": 0, "bad": 0, "cost": 0.0, "tok": 0}

    def work(b):
        out, cost, tok = run_batch(b, args.model)
        with lock:
            for r in b:
                v = out.get(r[0])
                if v is None:
                    tot["bad"] += 1
                    continue
                con.execute("INSERT OR REPLACE INTO sentence_gen VALUES (?,?,?,?,?,?,?,?,?)",
                            (r[0], int(v["keep"]), v["ko"], v["context"], v["hint"], json.dumps(v["variants"], ensure_ascii=False),
                             args.model, cost / len(b), tok // len(b)))
                tot["ok" if v["keep"] else "drop"] += 1
            con.commit()
            tot["cost"] += cost
            tot["tok"] += tok
            print(f"  배치 완료: 누적 저장 {tot['ok'] + tot['drop']} / 실패 {tot['bad']} / 비용 ${tot['cost']:.3f}")

    with ThreadPoolExecutor(args.workers) as ex:
        list(ex.map(work, batches))
    n = max(1, tot["ok"] + tot["drop"])
    print(f"저장 {tot['ok'] + tot['drop']} (제외 표시 {tot['drop']}) / 검증 실패 {tot['bad']} / 출력 토큰 {tot['tok']} (문장당 {tot['tok'] // n}) / 비용 ${tot['cost']:.3f} (문장당 ${tot['cost'] / n:.4f})")


def apply(_args):
    con = connect()
    cols = [r[1] for r in con.execute("PRAGMA table_info(sentence)")]
    if "ko_original" not in cols:
        con.execute("ALTER TABLE sentence ADD COLUMN ko_original TEXT")
    con.execute("UPDATE sentence SET ko_original=ko WHERE ko_original IS NULL")
    if "excluded" not in cols:
        con.execute("ALTER TABLE sentence ADD COLUMN excluded INTEGER DEFAULT 0")
    rows = con.execute("SELECT sentence_id, keep, ko, context, hint, variants FROM sentence_gen").fetchall()
    for sid, keep, ko, ctx, hint, variants in rows:
        con.execute("UPDATE sentence SET ko=?, context=?, excluded=? WHERE sentence_id=?", (ko, ctx, 0 if keep else 1, sid))
        if hint:
            con.execute("UPDATE sentence SET must_use=? WHERE sentence_id=?", (hint, sid))
        con.execute("DELETE FROM sentence_answer WHERE sentence_id=? AND kind='variant_ai'", (sid,))
        for v in json.loads(variants or "[]"):
            con.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (sid, v, "variant_ai", 2))
    con.commit()
    print(f"반영 {len(rows)}문장 (제외 표시 {sum(1 for r in rows if not r[1])})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--chapters", default="")
    ap.add_argument("--model", default="haiku")
    ap.add_argument("--batch", type=int, default=25)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    apply(a) if a.apply else generate(a)
