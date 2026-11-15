"""Бесплатное локальное распознавание скриншота отзыва (EasyOCR, без API)."""
import io
import re
import statistics

import numpy as np
from PIL import Image, ImageFilter, ImageOps

_reader = None


def reader():
    global _reader
    if _reader is None:
        import easyocr
        _reader = easyocr.Reader(["ru", "en"], gpu=False, verbose=False)
    return _reader


# ---------------- распознавание ----------------
def _ocr(img):
    res = reader().readtext(np.array(img), paragraph=False, text_threshold=0.6, low_text=0.3,
                            contrast_ths=0.2, adjust_contrast=0.6, width_ths=0.6)
    return [r for r in res if r[2] > 0.2 and r[1].strip()]


def _score(res):
    return sum(c * len(t) for _, t, c in res)


def _fit(img, lo, hi):
    """Масштабируем так, чтобы длинная сторона попала в [lo, hi]: мелкий текст лучше читается при увеличении."""
    m = max(img.size)
    k = lo / m if m < lo else hi / m if m > hi else 1
    return img if k == 1 else img.resize((round(img.width * k), round(img.height * k)), Image.LANCZOS)


def _is_dark(img):
    return np.asarray(img.convert("L").resize((64, 64))).mean() < 120


def _enhance(img):
    g = ImageOps.autocontrast(img.convert("L"), cutoff=1).filter(ImageFilter.SHARPEN)
    return g.convert("RGB")


def _group_lines(res):
    """Склеиваем фрагменты в строки по вертикали; широкий горизонтальный зазор (иконка рядом с названием) разделяет блоки."""
    items = []
    for box, text, conf in res:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        items.append({"cy": sum(ys) / 4, "x": min(xs), "r": max(xs), "h": max(ys) - min(ys), "t": text.strip(), "c": conf})
    if not items:
        return [], 0
    mh = statistics.median(i["h"] for i in items) or 10
    items.sort(key=lambda i: i["cy"])
    rows, cur = [], [items[0]]
    for it in items[1:]:
        if abs(it["cy"] - statistics.mean(i["cy"] for i in cur)) < 0.55 * mh:
            cur.append(it)
        else:
            rows.append(cur)
            cur = [it]
    rows.append(cur)
    lines = []
    for row in rows:
        row.sort(key=lambda i: i["x"])
        seg = [row[0]]
        for it in row[1:]:
            if it["x"] - seg[-1]["r"] > 0.8 * mh:
                lines.append(" ".join(i["t"] for i in seg))
                seg = [it]
            else:
                seg.append(it)
        lines.append(" ".join(i["t"] for i in seg))
    return lines, statistics.mean(i["c"] for i in items)


def _good(res):
    return len(res) >= 3 and statistics.mean(c for _, _, c in res) >= 0.6 and sum(len(t) > 5 for _, t, _ in res) >= 3


def read_lines(img):
    """Поворот (фото бывает боком), тёмная тема, мелкий шрифт. Возвращает (строки сверху вниз, средняя уверенность)."""
    img = ImageOps.exif_transpose(img).convert("RGB")
    # 1) поворот: если прямой проход на уменьшенной копии уже уверенный, не крутим
    small = _fit(img, 700, 700)
    first = _ocr(small)
    if not _good(first):
        scores = {0: _score(first)}
        for r in (90, 270, 180):
            scores[r] = _score(_ocr(small.rotate(r, expand=True)))
        rot = max(scores, key=scores.get)
        if rot:
            img = img.rotate(rot, expand=True)
    # 2) основной проход на хорошем разрешении; при слабом результате пробуем инверсию (тёмная тема) и усиление контраста
    base = _fit(img, 1500, 2200)
    best = _ocr(base)
    if not _good(best) or statistics.mean(c for _, _, c in best) < 0.75:
        alts = [ImageOps.invert(base)] if _is_dark(base) else []
        alts.append(_enhance(base))
        for v in alts:
            res = _ocr(v)
            if _score(res) > _score(best):
                best = res
    return _group_lines(best)


# ---------------- разбор ----------------
PLAY = re.compile(r"общедоступн|публикован|роверенн|public review|published|google play|этот отзыв|review helpful|отзыв\w* на устройств", re.I)
APPLE = re.compile(r"оценки и отзывы|ratings and reviews|reviewed|изменить|^назад$|^edit$|app store|отзыв от|оценено", re.I)
DATE = re.compile(r"(\d{1,2})[./](\d{1,2})[./](\d{4})")
MONTHS = {"янв": 1, "фев": 2, "мар": 3, "апр": 4, "мая": 5, "май": 5, "июн": 6, "июл": 7, "авг": 8, "сен": 9, "окт": 10,
          "ноя": 11, "дек": 12, "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9,
          "oct": 10, "nov": 11, "dec": 12}
DATE_RU = re.compile(r"(\d{1,2})\s+([а-яa-z]{3,})\.?,?\s+(\d{4})", re.I)
DATE_EN = re.compile(r"([a-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})", re.I)
DEVICE = re.compile(r"^(телефон|планшет|phone|tablet|chromebook|часы|тв)\b", re.I)
NOISE = re.compile(r"^([\W\d_]{0,6}|[xXхХrR*★☆•\s]{3,})$")  # звёзды, значки, время, заряд
HEADER = re.compile(r"^(отзывы|reviews|оценки и отзывы|ratings and reviews|мои отзывы|назад|back)$", re.I)


def parse_date(line):
    m = DATE.search(line)
    if m:
        d, mo, y = m.groups()
        return f"{y}-{int(mo):02d}-{int(d):02d}"
    m = DATE_RU.search(line)
    if m and m.group(2)[:3].lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2)[:3].lower()]:02d}-{int(m.group(1)):02d}"
    m = DATE_EN.search(line)
    if m and m.group(1)[:3].lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(1)[:3].lower()]:02d}-{int(m.group(2)):02d}"
    return None


def _name_ok(l):
    return sum(ch.isalpha() for ch in l) >= 4 and not HEADER.match(re.sub(r"^[^\w]+", "", l).strip()) and not NOISE.match(l) and not PLAY.search(l) and not APPLE.search(l) and not parse_date(l) \
        and not re.fullmatch(r"\d{1,2}[:.]\d{2}.*", l)


def parse(lines):
    play = sum(1 for l in lines if PLAY.search(l))
    apple = sum(1 for l in lines if APPLE.search(l))
    store = "play" if play > apple else "apple" if apple > play else "unknown"
    out = {"store": store, "review_text": "", "review_title": "", "date": None, "rating": None, "lines": lines}
    di = next((i for i, l in enumerate(lines) if parse_date(l)), None)
    if di is not None:
        out["date"] = parse_date(lines[di])
    cands = []
    if store == "play":
        pi = next((i for i, l in enumerate(lines) if re.search(r"общедоступн|public review", l, re.I)), None)
        anchor = pi if pi is not None else di
        if anchor is not None:
            cands = [l for l in reversed(lines[:anchor]) if _name_ok(l)][:2]
        start = (di + 1) if di is not None else (pi + 1 if pi is not None else 0)
        if di is not None and start < len(lines) and DEVICE.match(lines[start]):
            start += 1
        out["review_text"] = " ".join(l for l in lines[start:] if not NOISE.match(l))
    elif store == "apple":
        di = next((i for i, l in enumerate(lines) if re.search(r"reviewed|отзыв от|оценено", l, re.I)), di)
        if di is not None:
            hi = max((i for i, l in enumerate(lines[:di]) if re.fullmatch(r"(изменить|edit)", l.strip(), re.I)), default=-1)
            head = [l for l in lines[hi + 1:di] if _name_ok(l)] if hi >= 0 else [l for l in lines[max(0, di - 4):di] if _name_ok(l)]
            if head:
                cands = [head[0]]
                latin = [l for l in head[1:] if re.fullmatch(r"[A-Za-z0-9 :\-&.']{2,}", l)]
                if latin:
                    cands.append(" ".join(latin))
                cands += [l for l in head[1:] if l not in latin][:1]
            rest = [l for l in lines[di + 1:] if not NOISE.match(l)]
            out["review_title"] = rest[0] if rest else ""
            out["review_text"] = " ".join(rest)
    else:  # магазин не определился: считаем, что до даты идёт название, после неё отзыв
        if di is not None:
            cands = [l for l in reversed(lines[:di]) if _name_ok(l)][:2]
            out["review_text"] = " ".join(l for l in lines[di + 1:] if not NOISE.match(l))
    out["app_candidates"] = list(dict.fromkeys(c.strip() for c in cands if c.strip()))[:3]
    out["app_name"] = " | ".join(out["app_candidates"])
    stars = re.search(r"[*★⭐]{3,5}", "\n".join(lines))
    out["rating"] = len(stars.group(0)) if stars else None
    return out


def scan(image_bytes, media_type=None):
    lines, conf = read_lines(Image.open(io.BytesIO(image_bytes)))
    d = parse(lines)
    d["confidence"] = round(conf, 2)
    return d
