"""UFC 한국어 사이트(kr.ufc.com)의 뉴스 헤드라인과 체급별 랭킹을 data/ufc.json으로 저장합니다.

robots.txt의 crawl-delay(15초)를 지키고, 6시간마다 두 페이지만 받습니다.
기사 본문은 저장하지 않고 제목·사진·링크만 모읍니다.
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://kr.ufc.com"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "ufc.json")
UA = "Mozilla/5.0 (compatible; corner-fight-app/1.0; +https://github.com/Charaing/corner-fight-app)"
NOW = datetime.now(timezone.utc)


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": UA, "Accept-Language": "ko"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.read().decode("utf-8", "ignore")
        except Exception as e:  # noqa: BLE001
            print("retry", path, e, file=sys.stderr)
            time.sleep(15 * (attempt + 1))
    return None


def text(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def absurl(u):
    return u if u.startswith("http") else BASE + u


def when(ago):
    """'2 day ago', '5 hours ago' 같은 상대 시간을 ISO 날짜로."""
    m = re.match(r"(\d+)\s*(min|hour|day|week|month|year)", ago or "")
    if not m:
        return ""
    n, u = int(m.group(1)), m.group(2)
    delta = {"min": timedelta(minutes=n), "hour": timedelta(hours=n), "day": timedelta(days=n),
             "week": timedelta(weeks=n), "month": timedelta(days=30 * n), "year": timedelta(days=365 * n)}[u]
    return (NOW - delta).isoformat()


def parse_news(h):
    out, seen = [], set()
    for m in re.finditer(r'<a[^>]+class="c-card--grid-card-trending[^"]*"\s+href="([^"]+)"(.*?)</a>', h, re.S):
        href, body = m.group(1), m.group(2)
        title = re.search(r'__headline[^"]*">(.*?)</h3>', body, re.S)
        if not title or href in seen:
            continue
        seen.add(href)
        img = re.search(r'<img[^>]+src="([^"]+)"', body)
        cat = re.search(r'__info-prefix">(.*?)</span>', body, re.S)
        ago = re.search(r'field--name-datetime[^>]*>(.*?)</div>', body, re.S)
        out.append({
            "title": text(title.group(1)),
            "url": absurl(href),
            "img": absurl(html.unescape(img.group(1))) if img else "",
            "cat": text(cat.group(1)) if cat else "",
            "date": when(text(ago.group(1)) if ago else ""),
        })
    return out


def parse_rankings(h):
    """기본으로 보이는 메타 랭킹을 쓰고, 메타에 없는 파운드 포 파운드는 미디어 랭킹에서 가져옵니다."""
    cut = h.find("view-display-id-meta_rankings")
    if cut < 0:
        return parse_groups(h)
    meta, media = parse_groups(h[cut:]), parse_groups(h[:cut])
    have = {g["div"] for g in meta}
    p4p = [g for g in media if g["p4p"] and g["div"] not in have]
    men = [g for g in p4p if not g["div"].startswith("Women")]
    women = [g for g in p4p if g["div"].startswith("Women")]
    wi = next((i for i, g in enumerate(meta) if g["div"].startswith("여성")), len(meta))
    return men + meta[:wi] + women + meta[wi:]


def parse_groups(h):
    out, seen = [], set()
    for g in re.findall(r'<div class="view-grouping">(.*?)</tbody>', h, re.S):
        head = re.search(r'view-grouping-header">(.*?)<', g)
        div = text(head.group(1)) if head else ""
        if not div or div in seen:  # 두 번째 묶음은 미디어 랭킹(같은 체급 반복)
            if div in seen:
                break
            continue
        seen.add(div)
        champ = re.search(r'rankings--athlete--champion.*?<h5><a href="([^"]+)"[^>]*>(.*?)</a>', g, re.S)
        img = re.search(r'rankings--athlete--champion.*?<img src="([^"]+)"', g, re.S)
        rows = []
        for tr in re.findall(r"<tr>(.*?)</tr>", g, re.S):
            rk = re.search(r'weight-class-rank">\s*(\d+)', tr)
            a = re.search(r'views-field-title"><a href="([^"]+)"[^>]*>(.*?)</a>', tr, re.S)
            ch = re.search(r'rank-(increase|decrease)">.*?</span>\s*(\d+)', tr, re.S)
            new = "rank-new" in tr or "신규" in tr
            if rk and a:
                rows.append({"rank": int(rk.group(1)), "name": text(a.group(2)), "slug": a.group(1).rsplit("/", 1)[-1],
                             "chg": (int(ch.group(2)) * (1 if ch.group(1) == "increase" else -1)) if ch else 0,
                             "new": new})
        out.append({
            "div": div,
            "p4p": "Pound-for-Pound" in div,
            "champ": {"name": text(champ.group(2)), "slug": champ.group(1).rsplit("/", 1)[-1],
                      "img": absurl(html.unescape(img.group(1))) if img else ""} if champ else None,
            "list": rows[:15],
        })
    return out


def main():
    try:
        with open(OUT, encoding="utf-8") as fh:
            old = json.load(fh)
    except Exception:  # noqa: BLE001
        old = {"news": [], "rankings": []}
    data = {"updated": NOW.isoformat(), "source": BASE, "news": old.get("news", []), "rankings": old.get("rankings", [])}

    h = get("/trending/all")
    news = parse_news(h) if h else []
    if news:
        prev = {n["url"]: n for n in data["news"]}
        for n in news:  # 처음 본 시각을 유지해 날짜가 흔들리지 않게
            if n["url"] in prev and prev[n["url"]].get("date"):
                n["date"] = prev[n["url"]]["date"]
        data["news"] = news
    print("news", len(news))

    time.sleep(15)
    h = get("/rankings")
    ranks = parse_rankings(h) if h else []
    if ranks:
        data["rankings"] = ranks
    print("rankings", len(ranks))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
