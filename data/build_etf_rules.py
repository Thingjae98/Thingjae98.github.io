"""전체 국내 ETF의 퇴직연금(DC/IRP) 투자가능 판정표를 만든다 → etf_rules.json

판정값 reti: "100"(안전자산, 한도 없음) | "70"(위험자산, 70% 한도) | "0"(불가)

소스
  1) etfcheck.co.kr  — 전 종목의 퇴직연금 편입 가능 여부 + 자산군 + 종목명 (백본)
  2) 운용사 4곳      — 100%/70% 비율 공시 (KODEX·TIGER·RISE·ACE·SOL)
  3) 나머지 운용사   — 자산군으로 추정하되 보수적으로 70%(위험자산) 처리, estimated 표시

실행: python build_etf_rules.py
"""
import hashlib, html, json, re, time, urllib.parse, urllib.request

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36"}
EC = "https://www.etfcheck.co.kr"


def checkclient():
    """etfcheck 내부 API 의 인증 헤더. 30초마다 바뀐다."""
    key = "v@MdfSWB"
    bucket = str(int(time.time() * 1000) // 30000)
    s = "".join(key[int(c)] if int(c) < len(key) else "undefined" for c in bucket)
    return hashlib.sha256(s.encode()).hexdigest()


def get(url, headers=None, data=None, retry=2):
    for i in range(retry + 1):
        try:
            req = urllib.request.Request(url, data=data, headers={**UA, **(headers or {})})
            return urllib.request.urlopen(req, timeout=60).read()
        except Exception as e:
            if i == retry:
                raise
            time.sleep(2)


def ec_get(path):
    h = {"Checkclient": checkclient(), "Referer": EC + "/", "Accept": "application/json"}
    return json.loads(get(EC + path, h).decode("utf-8"))


# ---------- 1) etfcheck: 전 종목 + 퇴직연금 가능 여부 ----------
def load_etfcheck():
    scr = ec_get("/user/etp/getEtpScreenerMobileList3?type[]=KETF&limit=3000")
    scr = scr.get("results", scr) if isinstance(scr, dict) else scr
    ctg = ec_get("/user/common/getEtpCtgMap")
    ctg = ctg.get("results", ctg) if isinstance(ctg, dict) else ctg
    pension_ok, assets = set(), {}
    for row in ctg:
        code = row.get("F16013")
        info = row.get("ctgInfo") or ""
        if not code:
            continue
        if "|1001002|" in info:
            pension_ok.add(code)
        m = re.search(r"\|(01\d\d)\|", info)  # 자산 대분류 0101주식 0102채권 …
        if m:
            assets[code] = m.group(1)
    out = {}
    for r in scr:
        code = r.get("F16013")
        if not code:
            continue
        out[code] = {
            "name": (r.get("SYMBOL") or r.get("F16002") or "").strip(),
            "issuer": (r.get("F33961") or "").strip(),
            "asset": assets.get(code),
            "scale": r.get("SCALE"),
            "pension_ok": code in pension_ok,
            "nav": r.get("F15028"),      # 순자산총액(원)
            "fee": r.get("F34763"),      # 총보수(%)
            "y1y": r.get("YLD_1Y"),      # 1년 수익률
            "y3m": r.get("YLD_3M"),
        }
    return out


# ---------- 2) 운용사별 100%/70% 공시 ----------
def rates_kodex():
    """삼성 KODEX. Cloudflare 로 막히면 이전에 받아둔 kodex_cache.json 을 쓴다."""
    out, p = {}, 1
    while True:
        try:
            d = json.loads(get(f"https://www.samsungfund.com/api/v1/kodex/product-pension-invest/search.do?category=&pageNo={p}").decode("utf-8"))
        except Exception:
            break  # 429 등으로 막히면 있는 만큼만 쓴다
        rows = d.get("productList") or []
        if not rows:
            break
        for x in rows:
            v = (x.get("ivPsbReti") or "").rstrip("%")
            out[x["stkTicker"]] = v if v in ("100", "70") else "0"
        p += 1
        time.sleep(2)
    if not out:
        try:
            out = json.load(open("kodex_cache.json", encoding="utf-8"))
            print("    (KODEX 는 차단되어 저장해 둔 값을 씁니다)")
        except Exception:
            pass
    else:
        json.dump(out, open("kodex_cache.json", "w", encoding="utf-8"), ensure_ascii=False)
    return out


def rates_tiger():
    body = b"listCnt=500&pageIndex=1&listType=list"
    h = {"Content-Type": "application/x-www-form-urlencoded"}
    t = html.unescape(get("https://investments.miraeasset.com/tigeretf/ko/product/search/list.ajax", h, body).decode("utf-8", "replace"))
    out = {}
    for m in re.finditer(r'data-ksd-fund="(KR7\w{9})".*?<div class="category">(.*?)</div>', t, re.S):
        isin, cat = m.groups()
        r = re.search(r"퇴직연금\s*(\d+)%", cat)
        out[isin[3:9]] = r.group(1) if r else "0"
    return out


def rates_rise():
    out = {}
    for p in range(1, 12):
        try:
            d = json.loads(get(f"https://kbam.co.kr/api/products/etfs/pension?page={p}", retry=0).decode("utf-8"))
        except Exception:
            break  # 마지막 페이지를 넘기면 400 이 온다
        rows = d.get("page_items") or d.get("results") or d.get("data") or (d if isinstance(d, list) else [])
        if not rows:
            break
        for x in rows:
            code = x.get("krx_cd") or x.get("fund_cd")
            rate = str(x.get("retirement_pension_rate") or "")
            if code and rate in ("70", "100"):
                out[code] = rate
        time.sleep(1)
    return out


def rates_ace():
    d = json.loads(get("https://papi.aceetf.co.kr/api/funds/pension?page=1&size=500").decode("utf-8"))
    rows = d.get("content") or d.get("results") or d.get("data") or []
    out = {}
    for x in rows:
        code = (x.get("badge") or {}).get("stockCode") or x.get("stockCode")
        rate = str(x.get("retirementPensionRatio") or "")
        if code and rate in ("70", "100"):
            out[code] = rate
    return out


def rates_sol():
    t = get("https://www.soletf.com/ko/strategy/pension").decode("utf-8", "replace")
    out = {}
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        cells = [re.sub(r"<[^>]+>", " ", c) for c in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        cells = [re.sub(r"\s+", " ", html.unescape(c)).strip() for c in cells]
        if len(cells) < 5:
            continue
        code = next((c for c in cells if re.fullmatch(r"\w{6}", c)), None)
        if not code:
            continue
        reti = cells[-1]
        out[code] = "100" if "100" in reti else "70" if "70" in reti else "0"
    return out


# ---------- 3) 조립 ----------
SAFE_ASSETS = {"0102", "0108", "0104"}  # 채권 / 단기자금 / 멀티에셋
RISKY_NAME = re.compile(r"하이일드|리츠|인컴|SOFR|커버드콜")


def main():
    base = load_etfcheck()
    print(f"etfcheck: {len(base)}종 (퇴직연금 가능 {sum(1 for v in base.values() if v['pension_ok'])}종)")

    rates = {}
    for name, fn in [("TIGER", rates_tiger), ("RISE", rates_rise), ("ACE", rates_ace), ("SOL", rates_sol), ("KODEX", rates_kodex)]:
        try:
            r = fn()
            rates.update(r)
            print(f"  {name}: {len(r)}종 공시")
        except Exception as e:
            print(f"  {name}: 실패 ({str(e)[:60]})")

    out, stat = {}, {"100": 0, "70": 0, "0": 0, "추정": 0}
    for code, v in base.items():
        if not v["pension_ok"]:
            reti, est = "0", False
        elif code in rates:
            reti, est = rates[code], False
        else:
            # 공시가 없으면 보수적으로: 채권·단기자금·멀티에셋이고 이름에 위험 신호가 없을 때만 100%
            safe = v["asset"] in SAFE_ASSETS and not RISKY_NAME.search(v["name"])
            reti, est = ("100" if safe else "70"), True
        def num(x):
            try: return float(str(x).replace(",", ""))
            except Exception: return None
        nav_v = num(v.get("nav")); fee_v = num(v.get("fee")); y1_v = num(v.get("y1y"))
        nav_eok = round(nav_v / 1e8) if nav_v else None
        out[code] = {"name": v["name"], "issuer": v["issuer"], "reti": reti}
        if v.get("asset"): out[code]["a"] = v["asset"]
        if nav_eok: out[code]["nav"] = nav_eok              # 억 원
        if fee_v is not None: out[code]["fee"] = fee_v
        if y1_v is not None: out[code]["y1"] = round(y1_v, 1)
        if est:
            out[code]["est"] = 1
            stat["추정"] += 1
        stat[reti] += 1

    json.dump(out, open("etf_rules.json", "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"저장 완료 {len(out)}종 — 100%: {stat['100']}, 70%: {stat['70']}, 불가: {stat['0']} (추정 {stat['추정']}종)")


if __name__ == "__main__":
    main()
