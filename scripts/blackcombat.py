"""블랙컴뱃 일정·결과·선수 기록을 Sherdog에서 모아 data/blackcombat.json으로 저장합니다.

GitHub Actions가 6시간마다 실행합니다. 표준 라이브러리만 씁니다.
이미 받은 지난 대회와 최근 받은 선수 정보는 다시 받지 않아 요청 수를 적게 유지합니다.
"""
import html
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = "https://www.sherdog.com"
ORG = BASE + "/organizations/Black-Combat-17215"
OUT = os.path.join(os.path.dirname(__file__), "..", "data", "blackcombat.json")
UA = "Mozilla/5.0 (compatible; corner-fight-app/1.0; +https://github.com/Charaing/corner-fight-app)"
DELAY = 1.2
MAX_FIGHTER_FETCH = int(os.environ.get("MAX_FIGHTER_FETCH", "140"))
NOW = datetime.now(timezone.utc)


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "en"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "ignore")
            time.sleep(DELAY)
            return body
        except Exception as e:  # noqa: BLE001
            print("retry", url, e, file=sys.stderr)
            time.sleep(4 * (attempt + 1))
    return None


def text(s):
    s = re.sub(r"<br\s*/?>", " ", s or "")
    s = re.sub(r"<[^>]+>", "", s)
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


def img(src):
    if not src:
        return ""
    return src if src.startswith("http") else BASE + src


def fid(href):
    m = re.search(r"/fighter/([^\"'?#]+)", href or "")
    return m.group(1) if m else ""


def parse_org(h):
    events = []
    for m in re.finditer(r"<tr onclick=\"document.location='/events/([^']+)';\".*?</tr>", h, re.S):
        row = m.group(0)
        d = re.search(r'itemprop="startDate" content="([^"]+)"', row)
        name = re.search(r'itemprop="name">(.*?)</span>', row, re.S)
        loc = re.search(r'itemprop="location">(.*?)</td>', row, re.S)
        events.append({
            "id": m.group(1),
            "name": text(name.group(1)) if name else m.group(1),
            "date": d.group(1)[:10] if d else "",
            "venue": text(loc.group(1)) if loc else "",
        })
    seen, out = set(), []
    for e in events:
        # 같은 이름의 브라질 단체(2020년 이전) 대회는 제외
        if "Brazil" in e["venue"] or e["date"] < "2021-01-01":
            continue
        if e["id"] not in seen:
            seen.add(e["id"])
            out.append(e)
    return out


def result_of(block):
    m = re.search(r'final_result (\w+)', block)
    return m.group(1).lower() if m else ""


def parse_side(block):
    a = re.search(r'href="(/fighter/[^"]+)"[^>]*>\s*<span itemprop="name">(.*?)</span>', block, re.S)
    im = re.search(r'<img[^>]+src="([^"]+_images/fighter/[^"]+)"', block)
    title = re.search(r'title="([^"]+)"', block)
    nick = ""
    if title:
        n = re.search(r"'([^']+)'", html.unescape(title.group(1)))
        nick = n.group(1) if n else ""
    rec = re.search(r'class="record">\s*([\d]+-[\d]+-[\d]+)', block)
    return {
        "name": text(a.group(2)) if a else "미정",
        "fid": fid(a.group(1)) if a else "",
        "img": img(im.group(1)) if im else "",
        "nick": nick,
        "rec": rec.group(1) if rec else "",
        "res": result_of(block),
    }


def parse_event(h):
    fights = []
    # 메인 이벤트
    mc = re.search(r'<div class="fight_card">(.*?)</table>', h, re.S)
    if mc:
        blk = mc.group(1)
        left = re.search(r'fighter left_side(.*?)<div class="versus">', blk, re.S)
        right = re.search(r'fighter right_side(.*?)<table class="fight_card_resume">', blk, re.S)
        vs = re.search(r'<div class="versus">(.*?)</div>\s*<div class="fighter right_side', blk, re.S)
        res = re.search(r'<table class="fight_card_resume">(.*)', blk, re.S)
        cells = re.findall(r"<td>(.*?)</td>", res.group(1), re.S) if res else []
        vals = {}
        for c in cells:
            k = re.search(r"<em>(.*?)</em>", c)
            if k:
                vals[text(k.group(1)).lower()] = text(re.sub(r"<em>.*?</em>", "", c))
        if left and right:
            vtxt = vs.group(1) if vs else ""
            wc = re.search(r'weight_class">(.*?)</span>', vtxt)
            fights.append({
                "no": int(re.sub(r"\D", "", vals.get("match", "0")) or 0),
                "main": True,
                "title": "TITLE FIGHT" in vtxt.upper(),
                "wc": text(wc.group(1)) if wc else "",
                "method": vals.get("method", ""),
                "rd": vals.get("round", ""),
                "time": vals.get("time", ""),
                "a": parse_side(left.group(1)),
                "b": parse_side(right.group(1)),
            })
    for row in re.findall(r'<tr itemprop="subEvent".*?</tr>', h, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(tds) < 7:
            continue
        no = re.search(r"(\d+)\s*$", text(re.sub(r"<meta[^>]*>", "", tds[0])))
        wc = re.search(r'weight_class">(.*?)</span>', tds[2])
        fights.append({
            "no": int(no.group(1)) if no else 0,
            "main": False,
            "title": "title_fight" in tds[2],
            "wc": text(wc.group(1)) if wc else "",
            "method": text(re.search(r"<b>(.*?)</b>", tds[4], re.S).group(1)) if "<b>" in tds[4] else text(tds[4]),
            "rd": text(tds[5]),
            "time": text(tds[6]),
            "a": parse_side(tds[1]),
            "b": parse_side(tds[3]),
        })
    fights.sort(key=lambda f: f["no"])
    return fights


def parse_fighter(h):
    def grab(p, flags=re.S):
        m = re.search(p, h, flags)
        return text(m.group(1)) if m else ""
    f = {
        "name": grab(r'<span class="fn">(.*?)</span>'),
        "nick": grab(r'<span class="nickname">"?<em>(.*?)</em>'),
        "img": "",
        "age": grab(r"<td>AGE</td>\s*<td><b>(.*?)</b>"),
        "born": grab(r'itemprop="birthDate">(.*?)</span>'),
        "height": grab(r'itemprop="height">(.*?)</b>\s*<em>/</em>\s*([^<]*)'),
        "heightCm": "",
        "weight": grab(r'itemprop="weight">(.*?)</b>'),
        "nat": grab(r'itemprop="nationality">(.*?)</strong>'),
        "team": grab(r'class="association"[^>]*><span itemprop="name">(.*?)</span>'),
        "cls": grab(r'weightclass=[^"]*">(.*?)</a>'),
    }
    cm = re.search(r'itemprop="height">.*?</b>\s*<em>/</em>\s*([\d.]+)\s*cm', h, re.S)
    f["heightCm"] = cm.group(1) if cm else ""
    im = re.search(r'<img itemprop="image" src="([^"]+)" class="profile-image', h)
    f["img"] = img(im.group(1)) if im else ""

    def block(cls):
        m = re.search(r'<div class="' + cls + r'">(.*?)</div>\s*</div>\s*(?:<div class="(?:loses|draws)|</div>)', h, re.S)
        return m.group(1) if m else ""
    def num(seg, label):
        m = re.search(label + r'.*?<div class="pl">(\d+)</div>', seg, re.S)
        return int(m.group(1)) if m else 0
    wins = re.search(r'winloses win">\s*<span>Wins</span>\s*<span>(\d+)</span>', h)
    loss = re.search(r'winloses lose">\s*<span>Losses</span>\s*<span>(\d+)</span>', h)
    draw = re.search(r'winloses draws">\s*<span>Draws</span>\s*<span>(\d+)</span>', h)
    nc = re.search(r'winloses nc">\s*<span>N/C</span>\s*<span>(\d+)</span>', h)
    wseg = h[h.find('<div class="wins">'):h.find('<div class="loses">')] if '<div class="loses">' in h else ""
    lseg = h[h.find('<div class="loses">'):h.find('<div class="loses">') + 3000] if '<div class="loses">' in h else ""
    f.update({
        "w": int(wins.group(1)) if wins else 0, "l": int(loss.group(1)) if loss else 0,
        "d": int(draw.group(1)) if draw else 0, "nc": int(nc.group(1)) if nc else 0,
        "ko": num(wseg, "KO"), "sub": num(wseg, "SUBMISSIONS"), "dec": num(wseg, "DECISIONS"),
        "lko": num(lseg, "KO"), "lsub": num(lseg, "SUBMISSIONS"), "ldec": num(lseg, "DECISIONS"),
    })
    hist = []
    hs = h.find("module fight_history")
    if hs > 0:
        seg = h[hs:h.find("</table>", hs)]
        for row in re.findall(r"<tr>(.*?)</tr>", seg, re.S)[0:]:
            tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if len(tds) < 6 or "final_result" not in tds[0]:
                continue
            ev = re.search(r'href="/events/([^"]+)"[^>]*>(.*?)</a>', tds[2], re.S)
            dt = re.search(r'sub_line">(.*?)</span>', tds[2], re.S)
            hist.append({
                "res": result_of(tds[0]),
                "opp": text(tds[1]),
                "oppId": fid(tds[1]),
                "ev": text(ev.group(2)) if ev else text(tds[2]),
                "evId": ev.group(1) if ev else "",
                "date": text(dt.group(1)) if dt else "",
                "method": text(re.search(r"<b>(.*?)</b>", tds[3], re.S).group(1)) if "<b>" in tds[3] else text(tds[3]),
                "rd": text(tds[4]),
                "time": text(tds[5]),
            })
    f["hist"] = hist[:30]
    return f


def main():
    try:
        with open(OUT, encoding="utf-8") as fh:
            old = json.load(fh)
    except Exception:  # noqa: BLE001
        old = {"events": [], "fighters": {}}
    old_events = {e["id"]: e for e in old.get("events", [])}
    fighters = old.get("fighters", {})

    org = get(ORG)
    if not org:
        print("organization page unavailable; keeping previous data", file=sys.stderr)
        return 0
    events = parse_org(org)
    if not events:
        print("no events parsed; keeping previous data", file=sys.stderr)
        return 0

    recent_cut = (NOW - timedelta(days=45)).strftime("%Y-%m-%d")
    for e in events:
        prev = old_events.get(e["id"])
        done = prev and prev.get("fights") and all(f["a"]["res"] or f["b"]["res"] for f in prev["fights"])
        if prev and done and e["date"] < recent_cut:
            e["fights"] = prev["fights"]
            continue
        h = get(BASE + "/events/" + e["id"])
        e["fights"] = parse_event(h) if h else (prev or {}).get("fights", [])
        print("event", e["date"], e["name"], len(e["fights"]))

    # 최근 1년 + 예정 대회 출전 선수의 상세 기록
    year_cut = (NOW - timedelta(days=365)).strftime("%Y-%m-%d")
    want = []
    for e in sorted(events, key=lambda x: x["date"], reverse=True):
        if e["date"] < year_cut:
            continue
        for f in e["fights"]:
            for s in (f["a"], f["b"]):
                if s["fid"] and s["fid"] not in want:
                    want.append(s["fid"])
    fetched = 0
    week = (NOW - timedelta(days=7)).isoformat()
    for k in want:
        cur = fighters.get(k)
        if cur and cur.get("at", "") > week:
            continue
        if fetched >= MAX_FIGHTER_FETCH:
            break
        h = get(BASE + "/fighter/" + k)
        fetched += 1
        if not h:
            continue
        info = parse_fighter(h)
        info["at"] = NOW.isoformat()
        fighters[k] = info
    print("fighters fetched", fetched, "total", len(fighters))

    data = {"updated": NOW.isoformat(), "source": ORG, "events": events, "fighters": fighters}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
