"""E3 선별 1차: pattern_master 에 자동 플래그를 붙인다(집계만 출력, 문장·표현 비출력).
실행: python3 -I tools/etl/e3_select.py
규칙(자동, 사람 검토 전 초안):
  merge  : 관사(a/an/the)를 뺀 표준형이 같은 패턴 -> 가장 낮은 레벨 1개만 keep, 나머지 merge
  long   : 슬롯 제외 단어 9개 이상(문장에 가까운 고정 표현) -> review
  keep   : 그 외
"""
import sqlite3
from collections import defaultdict
from pathlib import Path

DB = Path(__file__).resolve().parent.parent.parent / "data" / "personal.sqlite"
ART = {"a", "an", "the"}
ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}

con = sqlite3.connect(DB)
cols = [r[1] for r in con.execute("PRAGMA table_info(pattern_master)")]
for c, t in (("words_n", "INTEGER"), ("norm2", "TEXT"), ("flag", "TEXT"), ("merge_to", "INTEGER")):
    if c not in cols:
        con.execute(f"ALTER TABLE pattern_master ADD COLUMN {c} {t}")
rows = con.execute("SELECT pattern_id, skeleton, level FROM pattern_master").fetchall()
groups = defaultdict(list)
for pid, sk, lv in rows:
    w = [x for x in sk.split() if x != "_"]
    n2 = " ".join(x for x in w if x not in ART)
    groups[n2].append((ORDER.get(lv, 9), pid, len(w)))
    con.execute("UPDATE pattern_master SET words_n=?, norm2=? WHERE pattern_id=?", (len(w), n2, pid))
cnt = {"keep": 0, "merge": 0, "review": 0}
for n2, g in groups.items():
    g.sort()
    head = g[0][1]
    for i, (_, pid, wn) in enumerate(g):
        if i > 0:
            flag, mt = "merge", head
        elif wn >= 9:
            flag, mt = "review", None
        else:
            flag, mt = "keep", None
        cnt[flag] += 1
        con.execute("UPDATE pattern_master SET flag=?, merge_to=? WHERE pattern_id=?", (flag, mt, pid))
con.commit()
print("전체", len(rows), cnt)
for lv, f, n in con.execute("SELECT level, flag, COUNT(*) FROM pattern_master GROUP BY level, flag ORDER BY level, flag"):
    print(f"  {lv} {f}: {n}")
print("단어수 분포(keep):", con.execute("SELECT MIN(words_n),MAX(words_n),ROUND(AVG(words_n),1) FROM pattern_master WHERE flag='keep'").fetchone())
print("review 중 단어수 9+:", con.execute("SELECT COUNT(*) FROM pattern_master WHERE flag='review'").fetchone()[0])
