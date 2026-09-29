// 아침 브리핑: 보유 종목 이슈 점검 + 오늘 일정. 하루 1회, 켠 사람에게만.
import { getQuote, prevDay } from "./quotes.js";
import { checkPension, etfShareLine } from "./pension.js";
import { marketLines } from "./market_calendar.js";

export const NO_HOLDINGS_NOTE = "보유 종목: 등록된 것 없음. 보유 종목 점검·안전자산·추천 칸은 빼고 시황과 앞으로 2주 일정만 쓴 뒤, 끝에 '자산 탭에서 보유 종목을 등록하시면 종목별 점검을 해드립니다.'를 한 줄 덧붙인다.";

/** 사용자 한 명의 브리핑을 만든다. LLM 한 번만 쓴다. */
export async function buildBrief(user, env, deps) {
  const { holdings, events } = deps;
  const pension = user.account_type !== "general";

  // 아침 8시엔 실시간 등락이 0%로 초기화돼 있으므로 전 거래일 등락을 쓴다
  const rows = await Promise.all(holdings.map(async (h) => {
    if (!h.code) return { name: h.name };
    try {
      const [q, pd] = await Promise.all([getQuote(h.code, env), prevDay(h.code).catch(() => null)]);
      const p = checkPension({ code: q.code, name: q.name, kind: q.kind, accountType: user.account_type });
      return { name: q.name, code: q.code, pd, group: p.group };
    } catch { return { name: h.name, code: h.code }; }
  }));

  const holdingLines = rows.map((r) => `- ${r.name}${r.code ? `(${r.code})` : ""}${r.pd ? ` 전 거래일(${r.pd.date.slice(5)}) ${r.pd.changeRate > 0 ? "+" : ""}${r.pd.changeRate}%${r.pd.week != null ? `, 5거래일 ${r.pd.week > 0 ? "+" : ""}${r.pd.week}%` : ""}` : ""}${pension && r.group ? ` [${r.group === "100" ? "안전자산" : "위험자산"}]` : ""}`);
  const eventLines = events.map((e) => `- ${e.at.slice(11)} ${e.title}`);
  const monday = new Date(Date.now() + 9 * 3600e3).getUTCDay() === 1;

  const format = [
    "1) 전 거래일 내 보유 종목 — 성격이 비슷한 것끼리 묶어 묶음별 전 거래일 등락을 표로. 주인공은 보유 ETF 다.",
    "2) 크게 움직인 이유 — 전 거래일 ±2% 넘게 움직인 묶음마다 원인 2~3개를 기사 근거와 함께. 없으면 '크게 움직인 종목 없음'.",
    "3) 보유 ETF 관련 최근 이슈 — 최근 48시간 기사만, 묶음마다 한 줄. 없으면 '특이 뉴스 없음'. 오래된 기사로 채우지 않는다.",
    "4) 전망 판단 — 묶음마다 '1~2주 전망(반등 우세/하락 우세/횡보) · 확신도(낮음/보통/높음) · 행동 의견(비중 확대/유지/축소) · 근거' 표. 확신도가 낮으면 '유지'. '오른다·내린다' 단정 금지. 표 아래 '전망은 참고 의견이며 틀릴 수 있습니다.'",
    "5) 이번 주 볼 일정 — 아래 공식 확정 일정과 보유 종목 구성 기업 실적발표 중 7일 안의 것.",
    ...(pension && monday ? ["6) (월요일만) 안전자산 확인과 추가로 볼 만한 ETF 1~2개 — 퇴직연금 매수 가능 여부, 이유, 편입 비중 제안(70% 한도 안)."] : []),
  ].join("\n");

  const prompt = [
    `${user.name}${user.honorific}께 아침에 보낼 투자 브리핑을 쓴다. 오늘은 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}.`,
    `말투: ${user.tone}`,
    "",
    "구글 검색으로 오늘 아침 기준 최신 뉴스를 확인한 뒤 아래 양식으로 쓴다.",
    format,
    "",
    "규칙:",
    "- 첫 줄은 요약이고 알림에 그대로 뜨므로 120자 안쪽: 전 거래일 보유 종목 흐름과 가장 큰 사건 하나.",
    "- 의견은 '참고 의견'이라고 밝히고 결정은 본인 몫이라고 한 줄 덧붙인다.",
    "- 뉴스와 숫자는 확인된 것만 쓴다. 전망은 '우세'와 확신도로만 말하고 단정하지 않는다.",
    "- 검색은 날짜를 박은 일반 검색 대신 '움직인 것 + 원인'(예: '반도체주 하락 이유')으로 한다. 기사 날짜를 확인한다.",
    "- 맨 끝에 기록용 블록을 붙인다(서버가 떼어 가서 사용자에게 안 보인다. 본문에서 언급하지 않는다). 형식: ```outlook 줄바꿈 [{\"group\":\"묶음 이름\",\"codes\":[\"보유 목록의 그 묶음 종목코드\"],\"view\":\"up|down|flat\",\"confidence\":\"low|mid|high\",\"action\":\"add|hold|reduce\"}] 줄바꿈 ```",
    "- 60대가 읽는다. 어려운 용어는 처음 나올 때 괄호로 푼다. 이모지는 쓰지 않는다.",
    "- 마크다운 소제목(##)과 글머리표를 쓰고 전체 1500자 안쪽.",
    "",
    rows.length ? "보유 종목(서버가 조회한 전 거래일 종가 기준 확정 등락):\n" + holdingLines.join("\n") : NO_HOLDINGS_NOTE,
    etfShareLine(user),
    marketLines(new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)),
    eventLines.length ? "\n오늘 일정:\n" + eventLines.join("\n") : "",
  ].join("\n");

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      tool_config: { include_server_side_tool_invocations: true }, // 없으면 검색 전 첫 문장에서 끊긴다
      generationConfig: { temperature: 0.5, maxOutputTokens: 8192 },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || ""}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) return null;

  // 알림에 띄울 짧은 요약: 첫 문단에서 뽑는다
  const short = text.replace(/^#+.*$/gm, "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" ").replace(/[*_`]/g, "").slice(0, 160);
  return {
    text,
    short: short || "오늘의 브리핑이 도착했습니다.",
    usage: { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 },
  };
}
