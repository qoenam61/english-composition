"""E5 문장 테이블 구성(원본 트랙): 패턴에 배정된 원본 예문을 sentence / sentence_answer 로 만든다. 집계만 출력.
실행: python3 -I tools/etl/e5_sentences.py
- must_use: 패턴 표준형(슬롯 제외 단어열)
- 허용 정답: 원본 영어 예문 1개(canonical). 변형 정답·대화 문맥(context)은 자체 생성 단계(후속)에서 채운다.
"""
import sqlite3
from pathlib import Path
DB = Path(__file__).resolve().parent.parent.parent / "data" / "personal.sqlite"
con = sqlite3.connect(DB)
for t in ("sentence_answer", "sentence"):
    con.execute(f"DROP TABLE IF EXISTS {t}")
con.execute("""CREATE TABLE sentence(sentence_id INTEGER PRIMARY KEY, pattern_id INTEGER NOT NULL, track TEXT NOT NULL,
  en TEXT NOT NULL, ko TEXT NOT NULL, context TEXT, must_use TEXT, difficulty TEXT, source_ref TEXT)""")
con.execute("""CREATE TABLE sentence_answer(sentence_id INTEGER, answer_en TEXT, kind TEXT, rule_version INTEGER DEFAULT 1)""")
rows = con.execute("""SELECT a.pattern_id, c.example, c.korean, m.skeleton, c.level, c.card_id
  FROM sentence_assign a JOIN cards c ON c.card_id=a.card_id
  JOIN pattern_master m ON m.pattern_id=a.pattern_id
  WHERE m.flag!='merge' ORDER BY a.pattern_id, c.card_id""").fetchall()
for pid, en, ko, sk, lv, cid in rows:
    cur = con.execute("INSERT INTO sentence(pattern_id,track,en,ko,must_use,difficulty,source_ref) VALUES (?,?,?,?,?,?,?)",
        (pid, "original", en, ko, " ".join(w for w in sk.split() if w != "_"), lv, cid))
    con.execute("INSERT INTO sentence_answer(sentence_id,answer_en,kind) VALUES (?,?,'canonical')", (cur.lastrowid, en))
con.commit()
n = len(rows)
print("sentence 행:", n, "| 패턴 수:", con.execute("SELECT COUNT(DISTINCT pattern_id) FROM sentence").fetchone()[0])
print("ko 누락:", con.execute("SELECT COUNT(*) FROM sentence WHERE ko IS NULL OR TRIM(ko)=''").fetchone()[0])
print("패턴 중 문장 0개:", con.execute("SELECT COUNT(*) FROM pattern_master WHERE flag!='merge' AND pattern_id NOT IN (SELECT pattern_id FROM sentence)").fetchone()[0])
print("영어 예문 중복(동일 패턴 내):", con.execute("SELECT COUNT(*) FROM (SELECT pattern_id,en FROM sentence GROUP BY pattern_id,en HAVING COUNT(*)>1)").fetchone()[0])
