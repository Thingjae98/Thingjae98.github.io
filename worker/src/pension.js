// 퇴직연금(DC/IRP) 계좌 투자가능 판정. 근거: 근로자퇴직급여보장법 시행규칙 §10, 퇴직연금감독규정 §9·§11 (2026-09-22 기준)
import rules from "./etf_rules.json";

const SOURCE_TABLE = "삼성(KODEX)·미래에셋(TIGER) 운용사 공개 '퇴직연금 투자가능' 표";
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
    if (r.reti === "0") return { verdict: "불가", group: "0", basis: `${SOURCE_TABLE}에 '퇴직연금 투자 불가'로 표시`, footer: FOOTER };
    return {
      verdict: "가능", group: r.reti,
      basis: r.reti === "100"
        ? `${SOURCE_TABLE}에 '퇴직연금 100%'. 채권형·주식 50% 미만 혼합·적격 TDF 등 안전자산이라 한도 없이 담을 수 있음(감독규정 §11①)`
        : `${SOURCE_TABLE}에 '퇴직연금 70%'. 위험자산이라 다른 위험자산과 합쳐 전체 적립금의 70%까지만 가능(시행규칙 §10①2호)`,
      footer: FOOTER,
    };
  }
  const n = name ? byName(name) : null;
  if (n) return { ...n, footer: FOOTER };
  if (kind === "etf" || kind === "etn")
    return { verdict: "확인 필요", group: null, basis: `${SOURCE_TABLE}에 없는 종목. 이름에 레버리지·인버스·원자재선물이 없으면 대개 70% 그룹이지만 운용사 표로 확인되지 않음`, footer: FOOTER };
  return { verdict: "확인 필요", group: null, basis: "종목 종류를 확인하지 못함", footer: FOOTER };
}

/** 위험자산(70% 그룹) 비중 계산. holdings: [{code,name,qty,price}] price=현재가 */
export function riskRatio(holdings, totalBalance, add) {
  const items = add ? [...holdings, add] : holdings;
  let risk = 0;
  for (const h of items) {
    const r = h.code && rules[h.code];
    const group = r ? r.reti : (h.name && byName(h.name) ? "0" : "70");
    if (group === "70" || group === "0") risk += (h.qty || 0) * (h.price || 0);
  }
  if (!totalBalance) return { risk, ratio: null };
  return { risk, ratio: Math.round((risk / totalBalance) * 1000) / 10 };
}

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
