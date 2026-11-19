"""E8 맥락 적용: data/context_<name>.json 의 문장별 앞 대사(context)와 회화체 변형 정답을 personal.sqlite 에 반영한다.

실행: python3 -I tools/etl/e8_apply_context.py data/context_ch1.json
형식: {"<sentence_id>": {"context": "A: ...", "variants": ["..."]}}
- 질문 제시문은 "(상황)" 형태, 평서문은 "Q: 상대 앞 대사" 형태의 영어 앞 대사.
- 변형 정답은 kind='variant_authored' 로 넣고, 다시 실행하면 같은 kind 행을 지우고 다시 넣는다(멱등).
- 입력 JSON 은 원본에서 파생된 변형 정답을 담으므로 data/(git 제외)에 둔다.
"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"


def main(path: str) -> None:
    items = json.loads(Path(path).read_text(encoding="utf-8"))
    con = sqlite3.connect(DB)
    ids = [int(k) for k in items]
    known = {r[0] for r in con.execute(f"SELECT sentence_id FROM sentence WHERE sentence_id IN ({','.join('?' * len(ids))})", ids)}
    missing = [i for i in ids if i not in known]
    if missing:
        raise SystemExit(f"존재하지 않는 sentence_id: {missing[:10]}")
    nctx = nvar = 0
    for k, v in items.items():
        sid = int(k)
        con.execute("UPDATE sentence SET context=? WHERE sentence_id=?", (v["context"], sid))
        nctx += 1
        con.execute("DELETE FROM sentence_answer WHERE sentence_id=? AND kind='variant_authored'", (sid,))
        for a in v.get("variants", []):
            con.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (sid, a, "variant_authored", 1))
            nvar += 1
    con.commit()
    print(f"맥락 {nctx}문장, 변형 정답 {nvar}개 반영")
    print("맥락 보유 문장:", con.execute("SELECT COUNT(*) FROM sentence WHERE context IS NOT NULL").fetchone()[0], "/", con.execute("SELECT COUNT(*) FROM sentence").fetchone()[0])


if __name__ == "__main__":
    main(sys.argv[1])
