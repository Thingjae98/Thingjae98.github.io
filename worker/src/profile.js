// 투자 성향 분석: 본인 매매일지 통계 + 종목의 위험 성격. 예측이 아니라 "성격 대조"를 위한 재료.
const UA = { "User-Agent": "Mozilla/5.0" };

/** 매매일지에서 성향을 뽑는다. trades: 날짜 오름차순 */
export function analyzeStyle(trades) {
  if (!trades.length) return { enough: false, note: "매매 기록이 없어 성향을 낼 수 없습니다. 매수·매도하실 때 말씀해 주시면 쌓입니다." };
  const byCode = {};
  for (const t of trades) (byCode[t.code || t.name] ||= []).push(t);

  const closed = []; // 매수→매도로 닫힌 거래
  for (const list of Object.values(byCode)) {
    const buys = [];
    for (const t of list) {
      if (t.side === "buy") { buys.push({ ...t, left: t.qty }); continue; }
      let need = t.qty;
      while (need > 0 && buys.length) {
        const b = buys[0];
        const use = Math.min(b.left, need);
        const days = Math.round((new Date(t.trade_date) - new Date(b.trade_date)) / 86400e3);
        closed.push({ name: t.name, qty: use, buy: b.price, sell: t.price, days, pnlPct: ((t.price - b.price) / b.price) * 100, hadPlan: !!(b.target_price || b.stop_price), stop: b.stop_price, hitStop: b.stop_price ? t.price <= b.stop_price : null });
        b.left -= use; need -= use;
        if (b.left <= 0) buys.shift();
      }
    }
  }
  const wins = closed.filter((c) => c.pnlPct > 0);
  const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const holdDays = closed.map((c) => c.days);
  const planned = trades.filter((t) => t.side === "buy" && (t.target_price || t.stop_price)).length;
  const buyCount = trades.filter((t) => t.side === "buy").length;
  const spanDays = Math.max(1, Math.round((new Date(trades[trades.length - 1].trade_date) - new Date(trades[0].trade_date)) / 86400e3));

  const avgHold = avg(holdDays);
  const horizon = avgHold == null ? null : avgHold <= 7 ? "초단기(일주일 이내)" : avgHold <= 30 ? "단기(한 달 이내)" : avgHold <= 120 ? "중기(서너 달)" : "장기(반년 이상)";
  return {
    enough: closed.length >= 3,
    trade_count: trades.length,
    closed_count: closed.length,
    avg_hold_days: avgHold == null ? null : Math.round(avgHold),
    hold_range: holdDays.length ? `${Math.min(...holdDays)}~${Math.max(...holdDays)}일` : null,
    horizon,
    win_rate_pct: closed.length ? Math.round((wins.length / closed.length) * 100) : null,
    avg_win_pct: avg(wins.map((c) => c.pnlPct))?.toFixed(1) ?? null,
    avg_loss_pct: avg(closed.filter((c) => c.pnlPct <= 0).map((c) => c.pnlPct))?.toFixed(1) ?? null,
    trades_per_month: Math.round((trades.length / spanDays) * 30 * 10) / 10,
    plan_rate_pct: buyCount ? Math.round((planned / buyCount) * 100) : 0,
    recent_closed: closed.slice(-5).map((c) => ({ 종목: c.name, 보유일: c.days, 손익률: c.pnlPct.toFixed(1) + "%", 계획있었음: c.hadPlan })),
    note: closed.length < 3 ? "닫힌 거래가 3건 미만이라 참고용입니다." : null,
  };
}

/** 종목의 위험 성격: 변동성·재무 안정성·컨센서스. 예측이 아니라 성격 표시. */
export async function riskProfile(code) {
  const end = new Date(Date.now() + 9 * 3600e3);
  const start = new Date(end.getTime() - 200 * 86400e3);
  const fmt = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const r = await fetch(`https://api.finance.naver.com/siseJson.naver?symbol=${code}&requestType=1&startTime=${fmt(start)}&endTime=${fmt(end)}&timeframe=day`, { headers: UA });
  if (!r.ok) throw new Error("시세 이력을 가져오지 못했습니다");
  const rows = (await r.text()).trim().replace(/'/g, '"').split("\n").map((l) => l.trim().replace(/,$/, "")).filter((l) => l.startsWith("["));
  const closes = [];
  for (const l of rows) { try { const a = JSON.parse(l); if (typeof a[4] === "number") closes.push(a[4]); } catch {} }
  if (closes.length < 30) throw new Error("시세 이력이 부족합니다");

  const rets = [];
  for (let i = 1; i < closes.length; i++) rets.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length);
  const annualVolPct = sd * Math.sqrt(252) * 100;
  // 최대 낙폭
  let peak = closes[0], mdd = 0;
  for (const c of closes) { if (c > peak) peak = c; mdd = Math.min(mdd, (c - peak) / peak); }

  const grade = annualVolPct < 15 ? "낮음" : annualVolPct < 25 ? "보통" : annualVolPct < 40 ? "높음" : "매우 높음";
  const suited = annualVolPct < 15 ? "장기 보유에 무난" : annualVolPct < 25 ? "중기 이상 권장" : "짧은 기간에도 손실 폭이 커질 수 있음";

  let consensus = null;
  try {
    const d = await (await fetch(`https://m.stock.naver.com/api/stock/${code}/integration`, { headers: UA })).json();
    if (d.consensusInfo) consensus = { 목표주가평균: d.consensusInfo.priceTargetMean, 투자의견평균: d.consensusInfo.recommMean, 기준일: d.consensusInfo.createDate, 설명: "증권사 애널리스트 평균이며 전망이 맞는다는 보장은 없습니다. 의견은 1에 가까울수록 매수 쪽." };
  } catch {}

  return {
    code,
    기간: `최근 ${closes.length}거래일`,
    연환산변동성: annualVolPct.toFixed(1) + "%",
    변동성등급: grade,
    최대낙폭: (mdd * 100).toFixed(1) + "%",
    기간수익률: (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(1) + "%",
    보유기간_적합성: suited,
    컨센서스: consensus,
    주의: "변동성은 과거 움직임의 크기일 뿐 앞으로의 방향이 아닙니다.",
  };
}
