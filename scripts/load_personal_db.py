"""원본 Sentence Kit JSON -> 개인용 SQLite DB 적재 (개인 학습 전용, 배포 금지).

실행: python3 -I scripts/load_personal_db.py
입력: private/original/sentence_kit_v1.1.json (git 제외)
출력: data/personal.sqlite (git 제외)
"""
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "private" / "original" / "sentence_kit_v1.1.json"
DST = ROOT / "data" / "personal.sqlite"


def kind_of(pattern: str) -> str:
    """structural=슬롯 있는 구조 패턴 / chunk=슬롯 없는 3단어+ 고정 표현 / lexical=단어·짧은 어구."""
    words = len(re.findall(r"[A-Za-z']+", pattern))
    slot = "~" in pattern or "+" in pattern or "..." in pattern or bool(re.search(r"[가-힣]", pattern))
    if slot and words >= 2:
        return "structural"
    if words <= 2:
        return "lexical"
    return "chunk"


def norm_pattern(pattern: str) -> str:
    p = re.sub(r"\(.*?\)", " ", pattern)
    p = re.sub(r"[~+/]", " ", p)
    p = re.sub(r"[가-힣]+", " ", p)
    p = re.sub(r"[^A-Za-z' ]", " ", p)
    return " ".join(p.lower().split())


def main() -> None:
    cards = json.loads(SRC.read_text(encoding="utf-8"))["cards"]
    DST.parent.mkdir(exist_ok=True)
    if DST.exists():
        DST.unlink()
    con = sqlite3.connect(DST)
    con.execute(
        """CREATE TABLE cards (
            card_id TEXT PRIMARY KEY, level TEXT NOT NULL, category TEXT, category_ko TEXT,
            pattern TEXT NOT NULL, norm_pattern TEXT, kind TEXT NOT NULL,
            meaning TEXT, description TEXT, example TEXT NOT NULL, korean TEXT NOT NULL,
            time_limit INTEGER, item_number INTEGER)"""
    )
    rows = [
        (
            c["cardId"], c["level"], c["category"], c["categoryKo"], c["pattern"],
            norm_pattern(c["pattern"]), kind_of(c["pattern"]), c.get("meaning"),
            c.get("description"), c["example"], c["korean"], c.get("timeLimit"),
            c.get("itemNumber"),
        )
        for c in cards
    ]
    con.executemany("INSERT INTO cards VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    con.execute("CREATE INDEX idx_cards_level_kind ON cards(level, kind)")
    con.commit()
    for lv, kd, n in con.execute("SELECT level, kind, COUNT(*) FROM cards GROUP BY level, kind ORDER BY level, kind"):
        print(lv, kd, n)
    print("total", con.execute("SELECT COUNT(*) FROM cards").fetchone()[0])
    con.close()


if __name__ == "__main__":
    main()
