"""E9 상황별 로드맵: 어휘 카드(kind='lexical')를 '패턴 1개 + 문장 1개'로 바꿔 주제(category)별 챕터로 편성한다.
e7_build_pack.py 가 불러서 쓴다(단독 실행 아님). 원본 카드 문장이라 track='original'(관리자 전용)이다.
- pattern_id/sentence_id = 100000 + 순번, chapter_id = 10001 부터 (기존 패턴 로드맵 ID와 겹치지 않게)
- 패턴 로드맵의 패턴도 대표 장소 한 곳(연결 카드 장소 다수결)의 챕터에 같은 id로 넣는다 → 어느 쪽에서 끝내도 양쪽 완료(진행도는 패턴 id 기준).
- 예문이 패턴 카드와 같은 어휘 카드는 따로 만들지 않는다(같은 카드 → 공유 패턴 하나로 통일).
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


def shared_places(src):
    """패턴 로드맵의 각 패턴을 대표 장소 한 곳에 배치한다(연결된 원본 카드 장소의 다수결, 동률은 TOPICS 순서).
    -> {장소: [(pattern_id, level, skeleton)]}. 두 장소에 걸친 패턴도 한 곳에만 넣는다."""
    order = {slug: i for i, (slug, _) in enumerate(TOPICS)}
    cards = {r[0]: r[1:] for r in src.execute("SELECT card_id, category, pattern, example FROM cards WHERE kind!='lexical'")}
    live = {r[0]: r[1:] for r in src.execute("SELECT pattern_id, level, skeleton FROM pattern_master WHERE flag!='merge'")}
    votes = {}
    for cid, pid in src.execute("SELECT card_id, pattern_id FROM sentence_assign"):
        if pid in live and cid in cards:
            pl = place_of(*cards[cid])
            if pl: votes.setdefault(pid, {}).setdefault(pl, 0); votes[pid][pl] += 1
    try:  # 신규 생성 문장(own)을 내용 기준으로 분류한 장소가 있으면 카드 다수결보다 우선한다(e10_gen_own.py classify)
        own = {pid: pl for pid, pl in src.execute("SELECT pattern_id, place FROM own_gen WHERE status='ok' AND place IS NOT NULL") if pid in live and pl in order}
    except Exception:  # noqa: BLE001 — own_gen 이 없는 DB
        own = {}
    out = {}
    for pid in set(votes) | set(own):
        v = votes.get(pid, {})
        pl = own.get(pid) or min(v, key=lambda k: (-v[k], order[k]))
        out.setdefault(pl, []).append((pid, live[pid][0], live[pid][1]))
    return out


def append(src, out):
    """src: personal.sqlite 연결, out: 팩 연결(스키마에 chapter.roadmap, roadmap 테이블 필요). 집계 dict 반환."""
    out.execute("INSERT INTO roadmap VALUES ('pattern','패턴 학습 로드맵',0)")
    all_rows = src.execute("SELECT card_id, level, pattern, korean, example, category FROM cards WHERE kind='lexical' ORDER BY card_id").fetchall()
    # 패턴 카드와 예문이 같은 어휘 카드는 같은 카드다 → 따로 만들지 않고 이미 공유 중인 패턴 카드 하나로 통일한다
    pat_ex = {r[0].strip().lower() for r in src.execute("""SELECT DISTINCT c.example FROM cards c JOIN sentence_assign a USING(card_id)
        JOIN pattern_master m ON m.pattern_id=a.pattern_id WHERE c.kind!='lexical' AND m.flag!='merge'""")}
    by_place = {}; n_dup = 0
    for cid, lv, pat, kor, ex, cat in all_rows:
        if ex.strip().lower() in pat_ex: n_dup += 1; continue
        pl = place_of(cat, pat, ex)
        if pl: by_place.setdefault(pl, []).append((cid, lv, pat, kor, ex))
    shared = shared_places(src)
    n_pat = n_ch = n_shared = 0; next_id = ID0; next_ch = CH0; per_place = {}
    for pos, (slug, ko) in enumerate(TOPICS, start=1):
        rows = by_place.get(slug, []); sh = shared.get(slug, [])
        if not rows and not sh: continue
        out.execute("INSERT INTO roadmap VALUES (?,?,?)", (slug, ko, pos))
        items = []  # (id, level, 정렬용 이름) — 어휘 문장은 새 id를 만들고, 공유 패턴은 기존 id를 그대로 쓴다
        for cid, lv, pat, kor, ex in rows:
            out.execute("INSERT INTO pattern VALUES (?,?,?)", (next_id, pat, lv))
            out.execute("INSERT INTO sentence VALUES (?,?,?,?,?,NULL,NULL,?,?)", (next_id, next_id, "original", ex, kor, lv, cid))
            out.execute("INSERT INTO sentence_answer VALUES (?,?,?,?)", (next_id, ex, "canonical", 1))
            items.append((next_id, lv, pat)); next_id += 1; n_pat += 1
        items += [(pid, lv, sk) for pid, lv, sk in sh]; n_shared += len(sh)
        items.sort(key=lambda r: (ORD[r[1]], r[2].lower(), r[0]))
        chs = plan_chapters(items)
        for lv, grp in chs:
            out.execute("INSERT INTO chapter(chapter_id, level, n_patterns, roadmap) VALUES (?,?,?,?)", (next_ch, lv, len(grp), slug))
            out.executemany("INSERT INTO chapter_pattern VALUES (?,?,?)", [(next_ch, p + 1, pid) for p, pid in enumerate(grp)])
            next_ch += 1; n_ch += 1
        per_place[slug] = (len(rows) + len(sh), len(chs))
    return {"cards": n_pat, "duplicates_merged": n_dup, "shared_patterns": n_shared, "chapters": n_ch, "per_place(cards,chapters)": per_place}
