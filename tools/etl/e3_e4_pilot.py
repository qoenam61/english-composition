"""E3 패턴 마스터 초안 + E4 원본 예문 매칭 시범.

실행: python3 -I tools/etl/e3_e4_pilot.py
입력: data/personal.sqlite (pattern_candidate, candidate_member, cards)
출력: 같은 DB 의 `pattern_master`, `sentence_assign` 테이블 + 집계 통계만 출력(문장 비출력)

E3: pattern_candidate 를 그대로 pattern_master 초안으로 승격(사람 검토 전 초안, status='draft').
E4: 모든 카드 예문(20,835)을 패턴에 배정.
  - structural/chunk 카드: 자기 패턴에 배정 (method='own_card')
  - lexical 카드: 예문 단어열에 패턴 표준형(skeleton)이 연속 부분열로 포함되면 배정 (method='match')
"""
import importlib.util
import re
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"

spec = importlib.util.spec_from_file_location("e2", ROOT / "tools" / "etl" / "e2_cluster.py")
e2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e2)


def main() -> None:
    con = sqlite3.connect(DB)
    con.execute("DROP TABLE IF EXISTS sentence_assign")
    con.execute("DROP TABLE IF EXISTS pattern_master")
    con.execute(
        """CREATE TABLE pattern_master (
        pattern_id INTEGER PRIMARY KEY, skeleton TEXT UNIQUE, level TEXT, n_cards INTEGER,
        status TEXT DEFAULT 'draft')"""
    )
    con.execute(
        """CREATE TABLE sentence_assign (
        card_id TEXT NOT NULL, pattern_id INTEGER NOT NULL, method TEXT NOT NULL,
        PRIMARY KEY (card_id, pattern_id))"""
    )
    # E3 초안
    con.execute(
        "INSERT INTO pattern_master(pattern_id, skeleton, level, n_cards) "
        "SELECT candidate_id, skeleton, min_level, n_cards FROM pattern_candidate"
    )
    pats = con.execute("SELECT pattern_id, skeleton, level FROM pattern_master").fetchall()
    level_of = {p[0]: p[2] for p in pats}

    # 자기 카드 배정
    own = con.execute("SELECT candidate_id, card_id FROM candidate_member").fetchall()
    con.executemany("INSERT OR IGNORE INTO sentence_assign VALUES (?,?,?)",
                    [(c, p, "own_card") for p, c in own])

    # 매칭 인덱스: 첫 단어 -> [(pattern_id, words tuple)]
    idx: dict[str, list[tuple[int, tuple[str, ...]]]] = defaultdict(list)
    for pid, sk, _ in pats:
        w = tuple(x for x in sk.split() if x != "_")
        if len(w) >= 2:
            idx[w[0]].append((pid, w))

    lex = con.execute("SELECT card_id, example FROM cards WHERE kind='lexical'").fetchall()
    matched_cards = 0
    per_pattern: Counter = Counter()
    rows = []
    for card_id, ex in lex:
        words = e2.skeleton(ex or "").split()
        hit = set()
        for i, w0 in enumerate(words):
            for pid, w in idx.get(w0, ()):
                if tuple(words[i:i + len(w)]) == w:
                    hit.add(pid)
        if hit:
            matched_cards += 1
            for pid in hit:
                rows.append((card_id, pid, "match"))
                per_pattern[pid] += 1
    con.executemany("INSERT OR IGNORE INTO sentence_assign VALUES (?,?,?)", rows)
    con.commit()

    n_pat = len(pats)
    total_cards = con.execute("SELECT COUNT(*) FROM cards").fetchone()[0]
    print(f"패턴 초안: {n_pat}")
    print(f"전체 카드(원본 문장): {total_cards}")
    print(f"자기 카드 배정: {len(own)}")
    print(f"lexical 카드: {len(lex)} / 패턴 매칭된 카드: {matched_cards} ({matched_cards / len(lex):.1%})")
    print(f"매칭 연결(카드-패턴, 중복 허용): {len(rows)}")
    assigned = con.execute("SELECT COUNT(DISTINCT card_id) FROM sentence_assign").fetchone()[0]
    print(f"패턴에 배정된 고유 카드: {assigned} / 미배정 {total_cards - assigned}")

    cnt = Counter()
    for pid, _, _ in pats:
        n = con.execute("SELECT COUNT(*) FROM sentence_assign WHERE pattern_id=?", (pid,)).fetchone()[0]
        cnt[min(n, 6)] += 1
    print("패턴별 원본 문장 수 분포(6=6개 이상):", dict(sorted(cnt.items())))

    print("레벨별 패턴 수 / 원본 문장 합:")
    for lv, n, s in con.execute(
        "SELECT m.level, COUNT(DISTINCT m.pattern_id), COUNT(a.card_id) "
        "FROM pattern_master m LEFT JOIN sentence_assign a ON a.pattern_id=m.pattern_id "
        "GROUP BY m.level ORDER BY m.level"
    ):
        print(f"  {lv}: 패턴 {n}, 원본 문장 {s}")
    top = per_pattern.most_common(1)
    print(f"한 패턴에 매칭된 lexical 카드 최대 수: {top[0][1] if top else 0}")
    con.close()


if __name__ == "__main__":
    main()
