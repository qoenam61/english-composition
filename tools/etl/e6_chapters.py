"""E6 챕터 편성 초안: 레벨 -> 앞 단어(틀) -> 표준형 순으로 정렬해 레벨별 정원(A 30 > B1 25 > B2 20 > C1 15 > C2 10)으로 묶는다. 집계만 출력.
실행: python3 -I tools/etl/e6_chapters.py
"""
import sqlite3
from collections import Counter
from pathlib import Path
DB = Path(__file__).resolve().parent.parent.parent / "data" / "personal.sqlite"
PER_BY_LEVEL = {'A1': 30, 'A2': 30, 'B1': 25, 'B2': 20, 'C1': 15, 'C2': 10}
ORDER = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
con = sqlite3.connect(DB)
con.execute("DROP TABLE IF EXISTS chapter_pattern"); con.execute("DROP TABLE IF EXISTS chapter")
con.execute("CREATE TABLE chapter(chapter_id INTEGER PRIMARY KEY, level TEXT, n_patterns INTEGER)")
con.execute("CREATE TABLE chapter_pattern(chapter_id INTEGER, position INTEGER, pattern_id INTEGER, PRIMARY KEY(chapter_id, position))")
rows = con.execute("SELECT pattern_id, skeleton, level FROM pattern_master WHERE flag!='merge'").fetchall()
rows.sort(key=lambda r: (ORDER.get(r[2], 9), r[1].split()[0] if r[1] else "", r[1]))
cid = 0
by_level = Counter()
i = 0
while i < len(rows):
    lv = rows[i][2]
    grp = []
    while i < len(rows) and rows[i][2] == lv and len(grp) < PER_BY_LEVEL[lv]:
        grp.append(rows[i]); i += 1
    cid += 1
    con.execute("INSERT INTO chapter VALUES (?,?,?)", (cid, lv, len(grp)))
    con.executemany("INSERT INTO chapter_pattern VALUES (?,?,?)", [(cid, p + 1, g[0]) for p, g in enumerate(grp)])
    by_level[lv] += 1
con.commit()
print("챕터 수", cid, "| 레벨별", dict(sorted(by_level.items())))
print("레벨별 챕터당 패턴 수:", PER_BY_LEVEL)
print("정원 미달 챕터:", con.execute("SELECT level, n_patterns FROM chapter c WHERE n_patterns < CASE level WHEN 'A1' THEN 30 WHEN 'A2' THEN 30 WHEN 'B1' THEN 25 WHEN 'B2' THEN 20 WHEN 'C1' THEN 15 ELSE 10 END").fetchall())
