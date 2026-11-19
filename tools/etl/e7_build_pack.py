"""E7 검증 + pack-personal 빌드. 집계만 출력.
실행: python3 -I tools/etl/e7_build_pack.py
출력: dist/pack-personal.sqlite (git 제외), 검증 결과 요약
"""
import hashlib, importlib.util, sqlite3
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent.parent
SRC = ROOT / "data" / "personal.sqlite"
OUT = ROOT / "dist" / "pack-personal.sqlite"
CAP = {"A1": 30, "A2": 30, "B1": 25, "B2": 20, "C1": 15, "C2": 10}
spec = importlib.util.spec_from_file_location("e2", ROOT / "tools" / "etl" / "e2_cluster.py")
e2 = importlib.util.module_from_spec(spec); spec.loader.exec_module(e2)

def stem(w):
    for suf in ("ing", "ed", "es", "s"):
        if w.endswith(suf) and len(w) - len(suf) >= 3:
            return w[:-len(suf)]
    return w

def contains(answer, must):
    words = [stem(x) for x in e2.skeleton(answer).split()]
    pos = -1
    for t in (stem(x) for x in e2.skeleton(must).split()):
        try:
            pos = words.index(t, pos + 1)
        except ValueError:
            return False
    return True

s = sqlite3.connect(SRC)
fails = []
live = s.execute("SELECT pattern_id, skeleton, level FROM pattern_master WHERE flag!='merge'").fetchall()
no_sent = s.execute("SELECT COUNT(*) FROM pattern_master WHERE flag!='merge' AND pattern_id NOT IN (SELECT pattern_id FROM sentence)").fetchone()[0]
if no_sent: fails.append(f"문장 없는 패턴 {no_sent}")
cp = s.execute("SELECT pattern_id, COUNT(*) FROM chapter_pattern GROUP BY pattern_id").fetchall()
if len(cp) != len(live) or any(n != 1 for _, n in cp): fails.append("패턴-챕터 매핑 불일치")
over = s.execute("SELECT c.level, c.n_patterns FROM chapter c").fetchall()
bad = [1 for lv, n in over if n > CAP[lv]]
if bad: fails.append(f"챕터 정원 초과 {len(bad)}")
nomust = s.execute("SELECT sentence_id, a.answer_en, se.must_use FROM sentence se JOIN sentence_answer a USING(sentence_id) WHERE a.kind='canonical'").fetchall()
miss = sum(1 for _, ans, m in nomust if not contains(ans, m))
print(f"정답이 필수 구문을 포함하지 않는 문장: {miss} / {len(nomust)}")
print("검증 실패 항목:", fails or "없음")

if OUT.exists(): OUT.unlink()
o = sqlite3.connect(OUT)
o.executescript("""
CREATE TABLE pattern(pattern_id INTEGER PRIMARY KEY, template TEXT, level TEXT);
CREATE TABLE sentence(sentence_id INTEGER PRIMARY KEY, pattern_id INTEGER, track TEXT, en TEXT, ko TEXT, context TEXT, must_use TEXT, difficulty TEXT, source_ref TEXT);
CREATE TABLE sentence_answer(sentence_id INTEGER, answer_en TEXT, kind TEXT, rule_version INTEGER);
CREATE TABLE chapter(chapter_id INTEGER PRIMARY KEY, level TEXT, n_patterns INTEGER);
CREATE TABLE chapter_pattern(chapter_id INTEGER, position INTEGER, pattern_id INTEGER);
CREATE TABLE pack_manifest(pack_id TEXT, version TEXT, track_set TEXT, built_at TEXT, content_hash TEXT);
""")
o.executemany("INSERT INTO pattern VALUES (?,?,?)", live)
# 정답이 필수 구문을 포함하지 않는 문장은 must_use 를 비워 힌트·채점이 억지 구문을 요구하지 않게 한다
ans = {sid: a for sid, a, _ in nomust}
o.executemany("INSERT INTO sentence VALUES (?,?,?,?,?,?,?,?,?)", [
    (r[0], r[1], r[2], r[3], r[4], r[5], r[6] if contains(ans[r[0]], r[6]) else None, r[7], r[8])
    for r in s.execute("SELECT * FROM sentence")])
for t, n in (("sentence_answer", 4), ("chapter", 3), ("chapter_pattern", 3)):
    rows = s.execute(f"SELECT * FROM {t}").fetchall()
    o.executemany(f"INSERT INTO {t} VALUES ({','.join('?'*n)})", rows)
h = hashlib.sha256()
for t in ("pattern", "sentence", "sentence_answer", "chapter", "chapter_pattern"):
    for r in o.execute(f"SELECT * FROM {t} ORDER BY 1,2"): h.update(repr(r).encode())
o.execute("INSERT INTO pack_manifest VALUES ('pack-personal','0.2.0','original','2026-11-19',?)", (h.hexdigest(),))
o.commit()
print("must_use 비움:", o.execute("SELECT COUNT(*) FROM sentence WHERE must_use IS NULL").fetchone()[0])
for t in ("pattern", "sentence", "chapter", "chapter_pattern"):
    print(t, o.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0])
print("hash", h.hexdigest()[:12])
