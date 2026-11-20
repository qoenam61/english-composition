"""E9 상황별 로드맵: 어휘 카드(kind='lexical')를 '패턴 1개 + 문장 1개'로 바꿔 주제(category)별 챕터로 편성한다.
e7_build_pack.py 가 불러서 쓴다(단독 실행 아님). 원본 카드 문장이라 track='original'(관리자 전용)이다.
- pattern_id/sentence_id = 100000 + 순번, chapter_id = 10001 부터 (기존 패턴 로드맵 ID와 겹치지 않게)
- 챕터 크기: 최대 40개(레벨 안에서 균등 분할). 10개 미만의 얇은 레벨은 이웃 레벨과 합친다.
"""
CAP = {"A1": 30, "A2": 30, "B1": 25, "B2": 20, "C1": 15, "C2": 10}
ORD = {"A1": 1, "A2": 2, "B1": 3, "B2": 4, "C1": 5, "C2": 6}
LEVELS = sorted(ORD, key=ORD.get)
ID0, CH0 = 100000, 10001
TOPICS = [  # (장소 슬러그, 표시 이름) — 드롭다운 순서. 패턴 로드맵(전체 패턴)은 별도로 맨 위에 있다.
    ("daily-talk", "🏠 일상·스몰토크"), ("workplace", "💼 직장 업무"), ("presentation", "🎤 발표·토론"), ("interview", "🤝 면접·취업"),
    ("school", "🏫 학교·학업"), ("hospital", "🏥 병원·건강"), ("restaurant", "🍽️ 식당·카페"), ("shopping-service", "🛍️ 쇼핑·서비스"),
    ("travel", "✈️ 여행·출장"),
]
# 원본 어휘 주제(category) -> 장소. 장소가 없는 주제(대화 기능·감정·묘사 등)는 일상·스몰토크로 모은다.
PLACE_OF = {
    "daily-life": "daily-talk", "people-relationships": "daily-talk", "emotions-attitudes": "daily-talk", "communication-functions": "daily-talk",
    "actions-events": "daily-talk", "describing-state": "daily-talk", "work-business": "workplace", "school-learning": "school",
    "health-body": "hospital", "food-cooking": "restaurant", "shopping-money": "shopping-service", "travel-places": "travel",
    "society-news": "presentation", "nature-science": "presentation", "abstract-ideas": "presentation",
}
# 키워드로 세부 장소를 덮어쓴다(면접·발표 전용 문장이 원본에는 적어서 낱말·예문에 단서가 있는 것만 옮긴다).
import re as _re
_INTERVIEW = _re.compile(r"\b(interview\w*|resum[eé]s?|applicants?|candidates?|recruit\w*|hir(?:e|ed|ing)|salary|job offer|job application|cover letter|promotion)\b", _re.I)
_PRESENT = _re.compile(r"\b(presentations?|presenter|slides?|audience|speeches|speech|debate\w*|lecture|keynote|panel|persuade|argument)\b", _re.I)
OVERRIDE_FROM = {"work-business", "school-learning", "communication-functions", "society-news", "abstract-ideas", "people-relationships", "daily-life"}


def place_of(category, pattern, example):
    if category in OVERRIDE_FROM:
        text = f"{pattern} {example}"
        if _INTERVIEW.search(text) and category in {"work-business", "school-learning", "daily-life", "people-relationships"}: return "interview"
        if _PRESENT.search(text) and category != "daily-life": return "presentation"
    return PLACE_OF.get(category)


MAXN, MINN = 40, 10  # 챕터 최대 문장 수 / 이보다 적은 레벨 묶음은 이웃 레벨과 합친다


def plan_chapters(cards):
    """cards: [(id, level, pattern)] 이미 정렬됨. -> [(level, [ids])]
    레벨(A1~C2)별로 묶고, 묶음이 MINN 미만이면 이웃(더 어려운 쪽, 마지막이면 쉬운 쪽)과 합친 뒤,
    묶음마다 최대 MAXN개로 균등 분할한다. 챕터 레벨 = 안에 든 가장 어려운 레벨."""
    groups = []
    for c in cards:
        if groups and groups[-1][0] == c[1]: groups[-1][1].append(c)
        else: groups.append([c[1], [c]])
    i = 0
    while i < len(groups) and len(groups) > 1:
        if len(groups[i][1]) < MINN:
            j = i + 1 if i + 1 < len(groups) else i - 1
            lo, hi = sorted((i, j))
            groups[hi][1] = groups[lo][1] + groups[hi][1]; groups[hi][0] = max(groups[lo][0], groups[hi][0], key=ORD.get)
            del groups[lo]; i = max(0, lo - 1)
        else: i += 1
    out = []
    for lv, grp in groups:
        n = -(-len(grp) // MAXN); size, extra = divmod(len(grp), n); pos = 0
        for k in range(n):
            m = size + (1 if k < extra else 0); part = grp[pos:pos + m]; pos += m
            out.append((max((g[1] for g in part), key=ORD.get), [g[0] for g in part]))
    return out


def append(src, out):
    """src: personal.sqlite 연결, out: 팩 연결(스키마에 chapter.roadmap, roadmap 테이블 필요). 집계 dict 반환."""
    out.execute("INSERT INTO roadmap VALUES ('pattern','패턴 학습 로드맵',0)")
    all_rows = src.execute("SELECT card_id, level, pattern, korean, example, category FROM cards WHERE kind='lexical' ORDER BY card_id").fetchall()
    by_place = {}
    for cid, lv, pat, kor, ex, cat in all_rows:
        pl = place_of(cat, pat, ex)
        if pl: by_place.setdefault(pl, []).append((cid, lv, pat, kor, ex))
    n_pat = n_ch = 0; next_id = ID0; next_ch = CH0; per_place = {}
    for pos, (slug, ko) in enumerate(TOPICS, start=1):
        rows = by_place.get(slug)
        if not rows: continue
        rows.sort(key=lambda r: (ORD[r[1]], r[2].lower(), r[0]))
        out.execute("INSERT INTO roadmap VALUES (?,?,?)", (slug, ko, pos))
        ids = {}
        for cid, lv, pat, kor, ex in rows:
            ids[cid] = next_id
            out.execute("INSERT INTO pattern VALUES (?,?,?)", (next_id, pat, lv))
            out.execute("INSERT INTO sentence VALUES (?,?,?,?,?,NULL,NULL,?,?)", (next_id, next_id, "original", ex, kor, lv, cid))
            out.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (next_id, ex, "canonical", 1))
            next_id += 1; n_pat += 1
        chs = plan_chapters([(ids[r[0]], r[1], r[2]) for r in rows])
        for lv, grp in chs:
            out.execute("INSERT INTO chapter(chapter_id, level, n_patterns, roadmap) VALUES (?,?,?,?)", (next_ch, lv, len(grp), slug))
            out.executemany("INSERT INTO chapter_pattern VALUES (?,?,?)", [(next_ch, p + 1, pid) for p, pid in enumerate(grp)])
            next_ch += 1; n_ch += 1
        per_place[slug] = (len(rows), len(chs))
    return {"cards": n_pat, "chapters": n_ch, "per_place(cards,chapters)": per_place}
