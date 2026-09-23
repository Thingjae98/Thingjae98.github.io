// 시장 일정: 발표 기관 공식 사이트에서 확인한 날짜만 넣는다 (2026-09-23 확인, 한국시간).
// FOMC 는 연준이 "직전 회의에서 확정될 때까지 잠정"이라고 밝힌 날짜다. 한은 발표 시각은 공식 자료에 없어 비워 둔다.
// 갱신: 연준 fomccalendars.htm, 한은 통화정책방향 결정회의 일정, BLS cpi.htm·empsit.htm (BLS 는 2026년 12월분까지만 공개됨)
const FED = "https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm";
const BOK = "https://www.bok.or.kr/portal/singl/crncyPolicyDrcMtg/listYear.do?mtgSe=A&menuNo=200755";
const CPI = "https://www.bls.gov/schedule/news_release/cpi.htm";
const JOBS = "https://www.bls.gov/schedule/news_release/empsit.htm";

export const MARKET_EVENTS = [
  { date: "2026-10-02", time: "21:30", title: "미국 9월 고용보고서 발표", source: JOBS },
  { date: "2026-10-14", time: "21:30", title: "미국 9월 소비자물가(CPI) 발표", source: CPI },
  { date: "2026-10-22", time: null, title: "한은 금통위 기준금리 결정", source: BOK },
  { date: "2026-10-29", time: "03:00", title: "미국 FOMC 금리 결정", source: FED },
  { date: "2026-11-06", time: "22:30", title: "미국 10월 고용보고서 발표", source: JOBS },
  { date: "2026-11-10", time: "22:30", title: "미국 10월 소비자물가(CPI) 발표", source: CPI },
  { date: "2026-11-26", time: null, title: "한은 금통위 기준금리 결정", source: BOK },
  { date: "2026-12-04", time: "22:30", title: "미국 11월 고용보고서 발표", source: JOBS },
  { date: "2026-12-10", time: "04:00", title: "미국 FOMC 금리 결정", source: FED },
  { date: "2026-12-10", time: "22:30", title: "미국 11월 소비자물가(CPI) 발표", source: CPI },
  { date: "2027-01-28", time: "04:00", title: "미국 FOMC 금리 결정", source: FED },
  { date: "2027-03-18", time: "03:00", title: "미국 FOMC 금리 결정", source: FED },
  { date: "2027-04-29", time: "03:00", title: "미국 FOMC 금리 결정", source: FED },
  { date: "2027-06-10", time: "03:00", title: "미국 FOMC 금리 결정", source: FED },
];

/** AI 에게 넘길 확정 일정 문단 (앞으로 days 일). 없으면 빈 문자열 */
export function marketLines(today, days = 14) {
  const list = upcomingMarket(today, days);
  return list.length ? "공식 확정 시장 일정(한국시간, 발표 기관 공식 일정표 기준 — 이 날짜·시각을 그대로 쓰고 다른 날짜로 바꾸지 말 것):\n"
    + list.map((e) => `- ${e.date}${e.time ? " " + e.time : ""} ${e.title}`).join("\n") : "";
}

/** today(YYYY-MM-DD)부터 days 일 안의 시장 일정 */
export function upcomingMarket(today, days) {
  const end = new Date(Date.parse(today + "T00:00:00Z") + days * 86400e3).toISOString().slice(0, 10);
  return MARKET_EVENTS.filter((e) => e.date >= today && e.date <= end);
}
