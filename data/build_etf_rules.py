"""KODEX·TIGER 운용사 공개 페이지에서 퇴직연금(DC/IRP) 투자가능 비율을 모아 etf_rules.json 을 만든다.
값: "100" | "70" | "0"(불가). 실행: python build_etf_rules.py
"""
import json, re, urllib.request, html, time

UA = {"User-Agent": "Mozilla/5.0"}

def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    return urllib.request.urlopen(req, timeout=30).read()

out = {}

# KODEX: JSON API, 20건씩 페이지
p = 1
while True:
    d = json.loads(get(f"https://www.samsungfund.com/api/v1/kodex/product-pension-invest/search.do?category=&pageNo={p}").decode("utf-8"))
    rows = d.get("productList") or []
    if not rows:
        break
    for x in rows:
        code = x["stkTicker"]
        reti = x["ivPsbReti"].rstrip("%")
        out[code] = {"name": x["fNm"], "issuer": "KODEX", "reti": reti if reti in ("100", "70") else "0"}
    p += 1
    time.sleep(2)  # 429 방지

# TIGER: 목록 ajax(UTF-8 HTML). 행마다 data-ksd-fund=ISIN, 카테고리 span에 "퇴직연금 70%/100%" 있으면 그 값, 없으면 불가
h = get("https://investments.miraeasset.com/tigeretf/ko/product/search/list.ajax",
        b"listCnt=500&pageIndex=1&listType=list").decode("utf-8", errors="replace")
h = html.unescape(h)
for m in re.finditer(r'data-ksd-fund="(KR7\d{9})".*?data-ksd-fund-nm="([^"]+)".*?<div class="category">(.*?)</div>', h, re.S):
    isin, name, cat = m.groups()
    code = isin[3:9]
    r = re.search(r"퇴직연금\s*(\d+)%", cat)
    out[code] = {"name": name, "issuer": "TIGER", "reti": r.group(1) if r else "0"}

json.dump(out, open("etf_rules.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
from collections import Counter
print(len(out), Counter((v["issuer"], v["reti"]) for v in out.values()))
