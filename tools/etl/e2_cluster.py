"""E2 군집화: structural·chunk 카드의 패턴 표현을 표준형(skeleton)으로 묶어 패턴 후보 군을 만든다.

실행: python3 -I tools/etl/e2_cluster.py
입력: data/personal.sqlite `cards` (패턴 표현 pattern/norm_pattern 만 사용 — 예문 en/ko 는 읽지 않는다)
출력: 같은 DB 의 `pattern_candidate`, `candidate_member` 테이블 + 집계 통계(문장·예문은 출력하지 않음)
"""
import re
import sqlite3
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"

# 축약형 → 풀어쓴 형태 (표현이 달라도 같은 패턴으로 묶기 위함)
CONTRACTIONS = [
    (r"\bi'd\b", "i would"), (r"\bi'm\b", "i am"), (r"\bi've\b", "i have"), (r"\bi'll\b", "i will"),
    (r"\byou'd\b", "you would"), (r"\byou're\b", "you are"), (r"\byou've\b", "you have"),
    (r"\bit's\b", "it is"), (r"\bthat's\b", "that is"), (r"\bthere's\b", "there is"),
    (r"\bwhat's\b", "what is"), (r"\blet's\b", "let us"), (r"\bhe's\b", "he is"), (r"\bshe's\b", "she is"),
    (r"\bdon't\b", "do not"), (r"\bdoesn't\b", "does not"), (r"\bdidn't\b", "did not"),
    (r"\bcan't\b", "cannot"), (r"\bwon't\b", "will not"), (r"\bisn't\b", "is not"),
    (r"\baren't\b", "are not"), (r"\bwasn't\b", "was not"), (r"\bhaven't\b", "have not"),
    (r"\bwouldn't\b", "would not"), (r"\bcouldn't\b", "could not"), (r"\bshouldn't\b", "should not"),
]
# 의미 없는 선택 어구 제거(관사 등은 유지 — 패턴 정체성에 영향 가능)
SLOT_WORDS = {"someone", "something", "somebody", "sb", "sth", "one's", "ones"}


def skeleton(norm: str) -> str:
    s = norm.lower()
    for pat, rep in CONTRACTIONS:
        s = re.sub(pat, rep, s)
    s = re.sub(r"[^a-z ]", " ", s)
    words = [("_" if w in SLOT_WORDS else w) for w in s.split()]
    return " ".join(words)


def main() -> None:
    con = sqlite3.connect(DB)
    con.execute("DROP TABLE IF EXISTS candidate_member")
    con.execute("DROP TABLE IF EXISTS pattern_candidate")
    con.execute(
        """CREATE TABLE pattern_candidate (
            candidate_id INTEGER PRIMARY KEY, skeleton TEXT NOT NULL UNIQUE,
            n_cards INTEGER, min_level TEXT, max_level TEXT, head2 TEXT)"""
    )
    con.execute(
        """CREATE TABLE candidate_member (
            candidate_id INTEGER NOT NULL, card_id TEXT NOT NULL, level TEXT, kind TEXT,
            PRIMARY KEY (candidate_id, card_id))"""
    )
    rows = con.execute(
        "SELECT card_id, level, kind, norm_pattern FROM cards WHERE kind IN ('structural','chunk')"
    ).fetchall()

    groups: dict[str, list[tuple[str, str, str]]] = {}
    for card_id, level, kind, norm in rows:
        key = skeleton(norm or "")
        if not key:
            continue
        groups.setdefault(key, []).append((card_id, level, kind))

    order = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
    for key, members in sorted(groups.items()):
        lvls = sorted((m[1] for m in members), key=lambda x: order.get(x, 9))
        head2 = " ".join(key.split()[:2])
        cur = con.execute(
            "INSERT INTO pattern_candidate(skeleton, n_cards, min_level, max_level, head2) VALUES (?,?,?,?,?)",
            (key, len(members), lvls[0], lvls[-1], head2),
        )
        cid = cur.lastrowid
        con.executemany(
            "INSERT INTO candidate_member VALUES (?,?,?,?)",
            [(cid, m[0], m[1], m[2]) for m in members],
        )
    con.commit()

    # ---- 집계 통계 (문장은 출력하지 않는다) ----
    n_cards = len(rows)
    n_groups = len(groups)
    sizes = Counter(len(m) for m in groups.values())
    print(f"대상 카드(structural+chunk): {n_cards}")
    print(f"표준형(skeleton) 군 수: {n_groups}")
    print("군 크기 분포(카드 수: 군 수):")
    for size in sorted(sizes)[:12]:
        print(f"  {size}: {sizes[size]}")
    big = sum(1 for m in groups.values() if len(m) >= 5)
    print(f"카드 5개 이상인 군: {big}")
    cover = sum(len(m) for m in groups.values() if len(m) >= 5)
    print(f"그 군들이 포함한 카드: {cover}")

    heads = Counter(" ".join(k.split()[:2]) for k in groups)
    print(f"앞 두 단어(head2) 기준 상위 묶음 수: {len(heads)}")
    print("레벨(min_level)별 군 수:")
    for lv, n in con.execute("SELECT min_level, COUNT(*) FROM pattern_candidate GROUP BY min_level ORDER BY min_level"):
        print(f"  {lv}: {n}")
    print("kind 별 군 수(군에 structural 이 하나라도 있으면 structural):")
    st = con.execute(
        "SELECT COUNT(DISTINCT candidate_id) FROM candidate_member WHERE kind='structural'"
    ).fetchone()[0]
    print(f"  structural 포함 군: {st} / 전체 {n_groups}")
    con.close()


if __name__ == "__main__":
    main()
