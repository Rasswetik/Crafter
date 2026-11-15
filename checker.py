"""Проверка: есть ли отзыв в App Store / Google Play."""
import json
import random
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher

UAS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
    "Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0",
]


class FetchError(Exception):
    """Магазин не отдал данные (блокировка, лимит запросов, сеть)."""


# ---------------- сеть: повторы и смена User-Agent ----------------
def fetch(url, tries=4, timeout=25):
    last = None
    for i in range(tries):
        req = urllib.request.Request(url, headers={
            "User-Agent": UAS[i % len(UAS)], "Accept": "*/*", "Accept-Language": "ru,en;q=0.8"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            last = e
            if e.code == 404:
                raise FetchError("HTTP 404")
            # 403/429/5xx у Apple и Google часто временные: ждём и пробуем снова с другим User-Agent
        except Exception as e:  # noqa: сеть, таймаут
            last = e
        time.sleep(0.7 * (2 ** i) + random.random() * 0.4)
    code = getattr(last, "code", None)
    if code in (403, 429):
        raise FetchError(f"Магазин временно ограничил запросы (HTTP {code}). Подождите минуту и повторите.")
    raise FetchError(f"Не удалось связаться с магазином: {last}")


def http_json(url):
    return json.loads(fetch(url).decode("utf-8"))


# ---------------- сравнение текстов ----------------
def norm(s):
    s = (s or "").lower().replace("ё", "е")
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def similarity(query, text):
    """0..1: насколько отзыв `text` совпадает с искомым `query` (устойчиво к ошибкам распознавания)."""
    q, t = norm(query), norm(text)
    if not q or not t:
        return 0.0
    short, long_ = sorted((q, t), key=len)
    if len(short) >= 12 and short in long_ and len(short) / len(long_) > 0.5:
        return 1.0
    if len(short) >= 30 and short in long_:  # фрагмент длинного отзыва
        return 0.95
    sm = SequenceMatcher(None, q, t, autojunk=False)
    score = sm.ratio()
    if len(short) >= 25 and len(long_) <= len(short) * 3:
        # распознавание могло обрезать или исказить края: считаем долю совпавших блоков (>=4 символа)
        cov = sum(b.size for b in sm.get_matching_blocks() if b.size >= 4) / len(short)
        if cov >= 0.9:
            score = max(score, 0.88)
    return score


def best_match(query, reviews, author=None):
    best = None
    qn = set(norm(query).split())
    for rv in reviews:
        full = (rv["title"] + " " + rv["text"]).strip()
        if len(qn) >= 3 and not (qn & set(norm(full).split())):
            continue  # нет ни одного общего слова: быстро отсекаем
        score = max(similarity(query, full), similarity(query, rv["text"]))
        if author and norm(author) and norm(author) == norm(rv["author"]):
            score = min(1.0, score + 0.05)
        if best is None or score > best[0]:
            best = (score, rv)
    return best


def name_sim(query, name):
    q, n = norm(query), norm(name)
    if not q or not n:
        return 0.0
    if q == n:
        return 1.0
    if len(q) >= 3 and (q in n or n in q):
        return 0.92
    qt, nt = set(q.split()), set(n.split())
    jac = len(qt & nt) / len(qt | nt) if qt | nt else 0
    return max(SequenceMatcher(None, q, n).ratio(), jac)


def pick_candidates(query, cands, k=3):
    """Из результатов поиска выбираем приложения, чьё имя похоже на распознанное; если таких нет, берём первое."""
    scored = sorted(((name_sim(query, c["name"]), -i, c) for i, c in enumerate(cands)), key=lambda x: (x[0], x[1]), reverse=True)
    if not scored:
        return []
    if scored[0][0] >= 0.95:
        return [scored[0][2]]
    strong = [c for s, _, c in scored if s >= 0.55][:k]
    return strong or [cands[0]]


# ---------------- App Store ----------------
def _apple_lookup(ids, country):
    data = http_json(f"https://itunes.apple.com/lookup?id={','.join(ids)}&country={country}")
    by = {str(a["trackId"]): a for a in data.get("results", []) if a.get("trackId")}
    return [{"id": i, "name": by[i]["trackName"], "url": by[i].get("trackViewUrl", "")} for i in ids if i in by]


def apple_candidates(query, country, n=6):
    m = re.search(r"/id(\d+)", query) or re.fullmatch(r"\s*(\d{6,})\s*", query)
    if m:
        return _apple_lookup([m.group(1)], country)
    q = urllib.parse.quote(query)
    try:  # 1) официальный поиск iTunes
        data = http_json(f"https://itunes.apple.com/search?term={q}&entity=software&limit={n}&country={country}")
        res = [{"id": str(a["trackId"]), "name": a["trackName"], "url": a.get("trackViewUrl", "")}
               for a in data.get("results", []) if a.get("trackId")]
        if res:
            return res
    except FetchError:
        pass
    # 2) запасной путь: веб-поиск apps.apple.com, из страницы берём id и уточняем через lookup
    html = fetch(f"https://apps.apple.com/{country}/iphone/search?term={q}").decode("utf-8", "ignore")
    ids = list(dict.fromkeys(re.findall(r"/id(\d{6,})", html)))[:n]
    return _apple_lookup(ids, country) if ids else []


def apple_reviews(app_id, country, pages=10):
    """-> (отзывы, partial). Если не загрузилась даже первая страница, это ошибка, а не «отзывов нет»."""
    out, partial = [], False
    for p in range(1, pages + 1):
        url = f"https://itunes.apple.com/{country}/rss/customerreviews/page={p}/id={app_id}/sortby=mostrecent/json"
        try:
            data = http_json(url)
        except FetchError as e:
            if p == 1 and "404" not in str(e):
                raise
            partial = p > 1 or partial
            break
        entries = data.get("feed", {}).get("entry", [])
        if isinstance(entries, dict):
            entries = [entries]
        entries = [e for e in entries if "im:rating" in e]
        if not entries:
            break
        for e in entries:
            out.append({"author": e["author"]["name"]["label"], "title": e["title"]["label"],
                        "text": e["content"]["label"], "rating": int(e["im:rating"]["label"]),
                        "date": e.get("updated", {}).get("label", "")[:10]})
    return out, partial


# ---------------- Google Play ----------------
def _play_call(fn, *a, **kw):
    last = None
    for i in range(4):
        try:
            return fn(*a, **kw)
        except Exception as e:  # noqa
            last = e
            if "404" in str(e) or "not found" in str(e).lower():
                raise FetchError("HTTP 404")
            time.sleep(0.7 * (2 ** i) + random.random() * 0.4)
    raise FetchError(f"Не удалось связаться с Google Play: {last}")


def play_candidates(query, country, lang, n=6):
    from google_play_scraper import app as gp_app, search
    m = re.search(r"[?&]id=([\w.]+)", query) or re.fullmatch(r"\s*([a-zA-Z][\w]*(\.[\w]+)+)\s*", query)
    if m:
        info = _play_call(gp_app, m.group(1), lang=lang, country=country)
        return [{"id": m.group(1), "name": info["title"], "url": f"https://play.google.com/store/apps/details?id={m.group(1)}"}]
    html_ids = []
    try:
        html = fetch("https://play.google.com/store/search?c=apps&hl=%s&gl=%s&q=%s" % (lang, country, urllib.parse.quote(query))).decode("utf-8", "ignore")
        html_ids = list(dict.fromkeys(re.findall(r"details\?id=([\w.]+)", html)))
    except FetchError:
        pass
    res = []
    try:
        hits = _play_call(search, query, lang=lang, country=country, n_hits=n + 2)
        used = {h["appId"] for h in hits if h.get("appId")}
        spare = [i for i in html_ids if i not in used]
        for h in hits:  # у первого результата в google_play_scraper бывает appId=None: берём id из веб-страницы
            pid = h.get("appId") or (spare.pop(0) if spare else None)
            if pid:
                res.append({"id": pid, "name": h["title"], "url": f"https://play.google.com/store/apps/details?id={pid}"})
    except FetchError:
        if not html_ids:
            raise
    if not res:
        for pid in html_ids[:3]:
            info = _play_call(gp_app, pid, lang=lang, country=country)
            res.append({"id": pid, "name": info["title"], "url": f"https://play.google.com/store/apps/details?id={pid}"})
    return res[:n]


def play_reviews(pkg, country, lang, limit=3000):
    from google_play_scraper import reviews, Sort
    out, seen, partial = [], set(), False
    for sort in (Sort.NEWEST, Sort.MOST_RELEVANT):
        token, got = None, 0
        while got < limit:
            try:
                batch, token = _play_call(reviews, pkg, lang=lang, country=country, sort=sort, count=200, continuation_token=token)
            except FetchError:
                if not out:
                    raise
                partial = True
                break
            if not batch:
                break
            for r in batch:
                if r["reviewId"] in seen:
                    continue
                seen.add(r["reviewId"])
                out.append({"author": r["userName"], "title": "", "id": r["reviewId"], "text": r["content"] or "",
                            "rating": r["score"], "date": r["at"].strftime("%Y-%m-%d")})
            got += len(batch)
            if token is None:
                break
    return out, partial


# ---------------- общее ----------------
RANK = {"found": 2, "similar": 1, "not_found": 0}


def finish(store, country, app, review, revs, partial, author):
    res = {"store": store, "country": country, "app": app, "checked": len(revs), "partial": partial}
    bm = best_match(review, revs, author) if revs else None
    res["status"] = "found" if bm and bm[0] >= 0.85 else "similar" if bm and bm[0] >= 0.6 else "not_found"
    if bm:
        res["score"] = round(bm[0], 2)
        res["match"] = bm[1]
        if store == "Google Play" and bm[1].get("id"):
            res["review_url"] = app["url"] + "&reviewId=" + bm[1]["id"]
        elif store == "App Store":
            res["review_url"] = f"https://apps.apple.com/{country}/app/id{app['id']}?see-all=reviews"
    return res


def query_variants(q):
    """Распознанное название может содержать мусор от значка рядом (например «2(лет Такси Ритм»): пробуем очищенные варианты."""
    toks = q.split()
    clean = [t for t in toks if re.fullmatch(r"[^\W\d_]+[:.,]?", t) or len(t) > 3]
    clean = [t for t in clean if not re.search(r"\d[^\W\d_]|[^\w\s:.\-&']", t)] or toks
    out = [q, " ".join(clean)]
    if len(toks) > 2:
        out += [" ".join(toks[1:]), " ".join(toks[:-1])]
    return [v for v in dict.fromkeys(v.strip() for v in out) if len(v) >= 2]


def check_store(store, query, review, country, lang, author=None):
    cands, used = [], query
    for v in query_variants(query):
        try:
            cands = apple_candidates(v, country) if store == "App Store" else play_candidates(v, country, lang)
        except FetchError:
            if v == query_variants(query)[-1]:
                raise
            continue
        if cands:
            used = v
            break
    if not cands:
        return {"store": store, "country": country, "error": "Приложение не найдено"}
    query = used
    best, err = None, None
    for app in pick_candidates(query, cands):
        try:
            revs, partial = apple_reviews(app["id"], country) if store == "App Store" else play_reviews(app["id"], country, lang)
        except FetchError as e:
            err = e
            continue
        r = finish(store, country, app, review, revs, partial, author)
        r["app_match"] = round(name_sim(query, app["name"]), 2)
        if best is None or (RANK[r["status"]], r.get("score", 0)) > (RANK[best["status"]], best.get("score", 0)):
            best = r
        if r["status"] == "found":
            break
    if best is None:
        raise err or FetchError("Не удалось получить отзывы")
    return best


def check_one(app_query, review, country="ru", lang="ru", stores=("apple", "play"), author=None):
    results = []
    for key, store in (("apple", "App Store"), ("play", "Google Play")):
        if key not in stores:
            continue
        try:
            results.append(check_store(store, app_query, review, country, lang, author))
        except Exception as e:  # noqa
            results.append({"store": store, "country": country, "error": str(e)})
    return results


def check(app_query, review, country="ru", lang="ru", stores=("apple", "play"), author=None):
    """app_query может содержать несколько вариантов названия через « | » — берём лучший результат."""
    names = [n.strip() for n in app_query.split("|") if n.strip()] or [app_query]
    if len(names) == 1:
        return check_one(names[0], review, country, lang, stores, author)
    best = {}
    for n in names:
        for r in check_one(n, review, country, lang, stores, author):
            k = (RANK.get(r.get("status"), -1), r.get("score", 0), r.get("app_match", 0))
            if r["store"] not in best or k > best[r["store"]][0]:
                best[r["store"]] = (k, r)
    return [v[1] for v in best.values()]
