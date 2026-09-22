// 시세: 네이버 증권 비공식 JSON(실시간, 무보증) → 실패 시 KRX Open API(전일 일별, 키 필요)
const UA = { "User-Agent": "Mozilla/5.0", Accept: "application/json" };
const num = (s) => (s == null ? null : Number(String(s).replace(/,/g, "")));

export async function searchSymbol(q) {
  const r = await fetch(`https://ac.stock.naver.com/ac?q=${encodeURIComponent(q)}&target=stock`, { headers: UA });
  if (!r.ok) throw new Error("naver ac " + r.status);
  const d = await r.json();
  return (d.items || []).filter((x) => x.nationCode === "KOR").slice(0, 5).map((x) => ({ code: x.code, name: x.name, market: x.typeName }));
}

export async function getQuote(code, env) {
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/basic`, { headers: UA });
    if (!r.ok) throw new Error("naver basic " + r.status);
    const d = await r.json();
    return {
      source: "네이버 증권(실시간)", code, name: d.stockName, kind: d.stockEndType,
      price: num(d.closePrice), change: num(d.compareToPreviousClosePrice), changeRate: Number(d.fluctuationsRatio),
      direction: d.compareToPreviousPrice?.text, marketStatus: d.marketStatus, at: d.localTradedAt,
    };
  } catch (e) {
    if (!env?.KRX_AUTH_KEY) throw e;
    return krxDaily(code, env.KRX_AUTH_KEY);
  }
}

// KRX Open API: 전 영업일 ETF/주식 일별시세. 승인된 키 필요. (미검증: 키 발급 후 실제 응답으로 필드명 확인 필요)
async function krxDaily(code, key) {
  const d = new Date(Date.now() + 9 * 3600e3);
  d.setUTCDate(d.getUTCDate() - 1);
  const basDd = d.toISOString().slice(0, 10).replace(/-/g, "");
  for (const svc of ["etp/etf_bydd_trd", "sto/stk_bydd_trd"]) {
    const r = await fetch(`https://data-dbg.krx.co.kr/svc/apis/${svc}?basDd=${basDd}`, { headers: { AUTH_KEY: key } });
    if (!r.ok) continue;
    const j = await r.json();
    const row = (j.OutBlock_1 || []).find((x) => x.ISU_CD === code || x.ISU_SRT_CD === code);
    if (row) return { source: `KRX 공식(${basDd} 종가)`, code, name: row.ISU_NM, price: num(row.TDD_CLSPRC), change: num(row.CMPPREVDD_PRC), changeRate: Number(row.FLUC_RT), kind: svc.startsWith("etp") ? "etf" : "stock" };
  }
  throw new Error("KRX 조회 실패");
}
