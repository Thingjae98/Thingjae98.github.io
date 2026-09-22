// 재무제표·투자지표: 네이버 금융 비공식 API (무보증). 단위는 네이버 표기 그대로(억 원).
const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`naver ${r.status}`);
  return r.json();
}

/** 연간/분기 재무제표. period: 'annual' | 'quarter' */
export async function getFinance(code, period = "annual") {
  const d = await get(`https://m.stock.naver.com/api/stock/${code}/finance/${period}`);
  const fi = d.financeInfo;
  if (!fi) throw new Error("재무 정보 없음(ETF·리츠 등은 재무제표가 없습니다)");
  const periods = fi.trTitleList.map((t) => ({ key: t.key, label: t.title, estimate: t.isConsensus === "Y" }));
  const rows = {};
  for (const r of fi.rowList) {
    rows[r.title] = {};
    for (const p of periods) rows[r.title][p.label] = r.columns?.[p.key]?.value ?? null;
  }
  return {
    code, period,
    unit: "매출액·영업이익·순이익은 억 원, 비율은 %, EPS·BPS·배당금은 원",
    periods: periods.map((p) => p.label + (p.estimate ? "(전망치)" : "")),
    rows,
    note: "출처: 네이버 금융. (전망치)는 증권사 컨센서스이며 확정 실적이 아닙니다.",
  };
}

/** 시가총액·PER·PBR·52주 등 요약 지표 */
export async function getKeyMetrics(code) {
  const d = await get(`https://m.stock.naver.com/api/stock/${code}/integration`);
  const want = ["marketValue", "per", "eps", "cnsPer", "cnsEps", "pbr", "bps", "dividendYieldRatio", "highPriceOf52Weeks", "lowPriceOf52Weeks", "foreignRate", "accumulatedTradingVolume"];
  const metrics = {};
  for (const x of d.totalInfos || []) if (want.includes(x.code)) metrics[x.key] = x.value;
  const out = { code, name: d.stockName, kind: d.stockEndType, metrics };
  if (d.industryCompareInfo?.industryName) out.industry = d.industryCompareInfo.industryName;
  if (d.description) out.description = String(d.description).slice(0, 300);
  // ETF 전용 지표(순자산·기초지수 등)
  if (d.etfKeyIndicator) out.etf = d.etfKeyIndicator;
  return out;
}
