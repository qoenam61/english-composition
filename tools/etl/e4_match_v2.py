"""E4 매칭 v2: 슬롯 사이 최대 2단어 삽입 허용 + 간단 어간 정규화. 집계만 출력.
실행: python3 -I tools/etl/e4_match_v2.py
"""
import importlib.util, re, sqlite3
from collections import defaultdict, Counter
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
DB = ROOT / "data" / "personal.sqlite"
spec = importlib.util.spec_from_file_location("e2", ROOT / "tools" / "etl" / "e2_cluster.py")
e2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(e2)
GAP = 2

def stem(w):
    for suf in ("ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[: -len(suf)]
    return w

con = sqlite3.connect(DB)
pats = con.execute("SELECT pattern_id, skeleton FROM pattern_master WHERE flag!='merge'").fetchall()
idx = defaultdict(list)
for pid, sk in pats:
    w = tuple(stem(x) for x in sk.split() if x != "_")
    if len(w) >= 2:
        idx[w[0]].append((pid, w))
con.execute("DELETE FROM sentence_assign WHERE method='match2'")
lex = con.execute("SELECT card_id, example FROM cards WHERE kind='lexical'").fetchall()
def match(words, w):
    for i, x in enumerate(words):
        if x != w[0]: continue
        pos = i
        for t in w[1:]:
            for j in range(pos + 1, min(pos + GAP + 2, len(words))):
                if words[j] == t:
                    pos = j; break
            else:
                break
        else:
            return True
    return False
rows, cards, per = [], set(), Counter()
for cid, ex in lex:
    words = [stem(x) for x in e2.skeleton(ex or "").split()]
    for i, x in enumerate(words):
        for pid, w in idx.get(x, ()):
            if match(words, w):
                rows.append((cid, pid, "match2")); cards.add(cid); per[pid] += 1
rows = list(set(rows))
con.executemany("INSERT OR IGNORE INTO sentence_assign VALUES (?,?,?)", rows)
con.commit()
print(f"lexical {len(lex)} / v2 매칭 카드 {len(cards)} ({len(cards)/len(lex):.1%}) / 연결 {len(rows)}")
tot = con.execute("SELECT COUNT(DISTINCT card_id) FROM sentence_assign").fetchone()[0]
print(f"배정된 고유 카드 {tot} / 20835 ({tot/20835:.1%})")
d = Counter()
for (pid,) in con.execute("SELECT pattern_id FROM pattern_master WHERE flag!='merge'"):
    n = con.execute("SELECT COUNT(*) FROM sentence_assign WHERE pattern_id=?", (pid,)).fetchone()[0]
    d[min(n, 6)] += 1
print("패턴별 원본 문장 수:", dict(sorted(d.items())))
print("한 카드가 매칭된 패턴 수 최대:", max(Counter(r[0] for r in rows).values()) if rows else 0)
