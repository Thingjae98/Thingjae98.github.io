// 퇴직연금(DC/IRP) 계좌 투자가능 판정. 근거: 근로자퇴직급여보장법 시행규칙 §10, 퇴직연금감독규정 §9·§11 (2026-09-22 기준)
import rules from "./etf_rules.json";

const SOURCE_TABLE = "국내 ETF 1,175종 판정표(etfcheck 편입가능 여부 + 운용사 5곳 비율 공시)";
const FOOTER = "최종 확인은 증권사 앱의 '퇴직연금 투자가능' 표시로 해주세요.";

// 종목명만으로 판정되는 규칙(운용사 표에 없을 때 보조)
function byName(name) {
  const n = name.replace(/\s/g, "");
  if (/레버리지|인버스|2X|3X|곱버스/i.test(n))
    return { verdict: "불가", group: "0", basis: "레버리지·인버스 ETF는 퇴직연금 계좌에서 매수 불가(감독규정 §9①2호 마목)" };
  if (/선물/.test(n) && /골드|금|은|원유|WTI|구리|천연가스|농산물|달러|엔|유로|통화/.test(n))
    return { verdict: "불가", group: "0", basis: "원자재·통화 선물 ETF는 파생상품 위험평가액 40% 초과로 불가(감독규정 §9①2호 마목)" };
  return null;
}

/** @returns {{verdict:'가능'|'불가'|'확인 필요', group:'100'|'70'|'0'|null, basis:string, footer:string}} */
export function checkPension({ code, name, kind, accountType = "pension" }) {
  // 일반 위탁계좌: 퇴직연금 규제가 적용되지 않는다
  if (accountType === "general") {
    if (/레버리지|인버스|2X|3X|곱버스/i.test((name || "").replace(/\s/g, "")))
      return { verdict: "가능", group: null, basis: "일반 위탁계좌라 레버리지·인버스도 매수 가능. 다만 증권사에 따라 금융투자교육 이수와 기본예탁금이 필요합니다", footer: "손실이 지수 배수로 커지는 상품이라 장기 보유에는 적합하지 않습니다." };
    return { verdict: "가능", group: null, basis: "일반 위탁계좌라 개별주식·ETF 모두 매수 가능하고 위험자산 한도도 없습니다", footer: "" };
  }
  // kind: 네이버 stockEndType (stock | etf | etn | reits ...)
  if (kind === "stock" && /리츠|인프라|REIT/i.test(name || ""))
    return { verdict: "가능", group: "70", basis: "국내상장 리츠·인프라펀드는 개별주식 금지의 예외로 가능하되 위험자산이라 70% 한도에 포함(시행규칙 §10②)", footer: FOOTER };
  if (kind === "stock")
    return { verdict: "불가", group: "0", basis: "개별 주식은 퇴직연금 계좌에서 직접 매수 불가(시행규칙 §10②, 감독규정 §11②1호). 국내상장 리츠·인프라펀드는 예외", footer: FOOTER };
  const r = code && rules[code];
  if (r) {
    if (r.reti === "0") return { verdict: "불가", group: "0", basis: `${SOURCE_TABLE}에서 퇴직연금 편입 불가로 확인(레버리지·인버스·선물형)`, footer: FOOTER };
    const est = r.est ? " ※ 운용사가 비율을 따로 공시하지 않아 자산군으로 추정한 값입니다" : "";
    return {
      verdict: "가능", group: r.reti,
      basis: (r.reti === "100"
        ? `안전자산으로 분류되어 한도 없이 담을 수 있음(감독규정 §11①). ${SOURCE_TABLE} 기준`
        : `위험자산이라 다른 위험자산과 합쳐 전체 적립금의 70%까지만 가능(시행규칙 §10①2호). ${SOURCE_TABLE} 기준`) + est,
      footer: FOOTER,
      estimated: !!r.est,
    };
  }
  const n = name ? byName(name) : null;
  if (n) return { ...n, footer: FOOTER };
  if (kind === "etf" || kind === "etn")
    return { verdict: "확인 필요", group: null, basis: `${SOURCE_TABLE}에 없는 종목입니다. 최근 상장했을 수 있습니다`, footer: FOOTER };
  return { verdict: "확인 필요", group: null, basis: "종목 종류를 확인하지 못함", footer: FOOTER };
}

/** 위험자산(70% 그룹) 비중 계산. holdings: [{code,name,qty,price}] price=현재가
 *  etfShare: 비중으로 등록한 종목이 계좌에서 차지하는 비율(%). 있으면 등록 비중 합이 이 값이 되게 줄이고 나머지는 안전자산으로 본다 */
export function riskRatio(holdings, totalBalance, add, etfShare = null) {
  const items = add ? [...holdings, add] : holdings;
  const isRisk = (h) => { const r = h.code && rules[h.code]; const g = r ? r.reti : (h.name && byName(h.name) ? "0" : "70"); return g === "70" || g === "0"; };
  // 금액을 아는 종목(수량×현재가)과 비중만 아는 종목을 나눈다
  const byQty = items.filter((h) => h.qty && h.price);
  const byWeight = items.filter((h) => !(h.qty && h.price) && h.weight_pct != null);
  const knownWeight = byWeight.reduce((s, h) => s + h.weight_pct, 0);
  const f = etfShare != null && knownWeight ? etfShare / knownWeight : 1; // 등록 비중 → 계좌 비중
  const riskWeight = byWeight.filter(isRisk).reduce((s, h) => s + h.weight_pct, 0) * f;
  const kw = { known_weight_pct: Math.round(knownWeight * 10) / 10 };
  // 비중만 있는 경우: 비중 합으로 바로 낸다
  if (!byQty.length && knownWeight > 0)
    return { risk: totalBalance ? Math.round((riskWeight / 100) * totalBalance) : 0, ratio: Math.round(riskWeight * 10) / 10, by_weight: true, ...kw };
  // 금액이 섞이면 전체 적립금이 있어야 계산할 수 있다
  if (!totalBalance) return { risk: 0, ratio: null, ...(knownWeight ? kw : {}) };
  const risk = byQty.filter(isRisk).reduce((s, h) => s + h.qty * h.price, 0) + (riskWeight / 100) * totalBalance;
  return { risk: Math.round(risk), ratio: Math.round((risk / totalBalance) * 1000) / 10, ...(knownWeight ? { by_weight: true, ...kw } : {}) };
}

/** 판정표에 있는 ETF 총보수(연 %). 없으면 null */
export const etfFee = (code) => (code && rules[code]?.fee) ?? null;

/** 등록 비중이 ETF 부분 기준일 때 AI 에게 알려줄 한 줄 */
export const etfShareLine = (u) => u.etf_share_pct == null ? "" :
  `등록한 종목 비중은 ETF 부분 안에서의 비중이다. 등록한 ETF는 계좌의 ${u.etf_share_pct}%이고, 나머지 ${100 - u.etf_share_pct}%는 예금·채권 등 안전자산이다. 위험자산 비중은 이것을 반영해 계산한다.`;

export function pensionRuleText(accountType = "pension") {
  if (accountType === "general") {
    return [
      "이 사용자의 계좌는 일반 위탁계좌다. 퇴직연금 규제(개별주식 금지, 레버리지·인버스 금지, 위험자산 70% 한도)가 적용되지 않는다.",
      "개별주식·ETF·리츠 모두 매수 가능하고 한도도 없다. 레버리지·인버스는 증권사별로 교육 이수와 기본예탁금 조건이 붙을 수 있다고만 안내한다.",
      "퇴직연금 관련 판정이나 70% 한도 이야기를 먼저 꺼내지 않는다.",
    ].join("\n");
  }
  return [
    "퇴직연금(DC·IRP) 계좌 투자 규칙 요약(2026-09 기준, 법령 원문):",
    "1) 개별주식·DR·해외상장 ETF·비상장 → 불가. 국내상장 리츠·인프라펀드는 가능(위험자산).",
    "2) 레버리지·인버스 ETF → 불가. 원자재·통화 선물 ETF → 불가(파생 위험평가액 40% 초과).",
    "3) 채권형·주식 50% 미만 혼합형·적격 TDF·MMF·예금 등 원리금보장 → 100% 가능.",
    "4) 그 외 ETF(주식형 등) → 위험자산, 합산 전체 적립금의 70%까지.",
    "5) 동일법인 30%, 계열 40% 집중한도(집합투자증권 제외). 시세 변동으로 한도를 넘은 건 위반 아님, 추가 매수만 제한.",
    "6) 위험자산 한도 100% 상향은 2026-07 기준 논의만 있고 미시행.",
    "연금 수령: 55세 이후 개시 신청. 퇴직금이 든 IRP는 5년 요건 면제. 연금수령한도 = 평가액 ÷ (11 − 수령연차) × 120%.",
    "퇴직금 부분 세금: 수령연차 10년 이하 퇴직소득세의 70%, 11~20년 60%, 20년 초과 50%. 일시금은 감면 없음.",
    "세액공제분·운용수익: 70세 미만 5.5%, 70~79세 4.4%, 80세 이상 3.3%(지방세 포함). 연 1,500만 원 초과 시 종합과세 또는 16.5% 분리과세 선택.",
    "세금·연금 답변에는 항상 '세무사나 증권사에 최종 확인'을 붙일 것.",
  ].join("\n");
}

const ASSET_LABEL = { "0101": "주식", "0102": "채권", "0103": "부동산", "0104": "멀티에셋", "0105": "원자재", "0106": "통화", "0107": "변동성", "0108": "단기자금", "0109": "가상자산" };

/** ETF 검색. 이름·운용사·자산군으로 찾고 순자산 큰 순으로 돌려준다. */
export function searchEtf({ query = "", pensionOnly = false, safeOnly = false, asset = null, limit = 12 }) {
  const words = String(query).trim().split(/\s+/).filter(Boolean);
  const hits = [];
  for (const [code, v] of Object.entries(rules)) {
    if (pensionOnly && v.reti === "0") continue;
    if (safeOnly && v.reti !== "100") continue;
    if (asset && v.a !== asset) continue;
    const hay = `${v.name} ${v.issuer} ${ASSET_LABEL[v.a] || ""}`;
    if (words.length && !words.every((w) => hay.includes(w))) continue;
    hits.push({
      code, 종목명: v.name, 운용사: v.issuer,
      자산군: ASSET_LABEL[v.a] || null,
      퇴직연금: v.reti === "0" ? "불가" : v.reti + "%",
      추정: v.est ? true : undefined,
      순자산_억원: v.nav ?? null, 총보수_퍼센트: v.fee ?? null, "1년수익률": v.y1 ?? null,
    });
  }
  hits.sort((a, b) => (b.순자산_억원 || 0) - (a.순자산_억원 || 0));
  return { total: hits.length, results: hits.slice(0, Math.min(limit, 25)),
    note: "순자산 큰 순입니다. '추정'은 운용사가 비율을 공시하지 않아 자산군으로 추정한 것이니 증권사 앱에서 확인이 필요합니다." };
}
