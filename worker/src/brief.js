// 아침 브리핑: 보유 종목 이슈 점검 + 오늘 일정. 하루 1회, 켠 사람에게만.
import { getQuote } from "./quotes.js";
import { checkPension, etfShareLine } from "./pension.js";

export const NO_HOLDINGS_NOTE = "보유 종목: 등록된 것 없음. 보유 종목 점검·안전자산·추천 칸은 빼고 시황과 앞으로 2주 일정만 쓴 뒤, 끝에 '자산 탭에서 보유 종목을 등록하시면 종목별 점검을 해드립니다.'를 한 줄 덧붙인다.";

/** 사용자 한 명의 브리핑을 만든다. LLM 한 번만 쓴다. */
export async function buildBrief(user, env, deps) {
  const { holdings, events } = deps;
  const pension = user.account_type !== "general";

  const rows = [];
  for (const h of holdings) {
    if (!h.code) { rows.push({ name: h.name }); continue; }
    try {
      const q = await getQuote(h.code, env);
      const p = checkPension({ code: q.code, name: q.name, kind: q.kind, accountType: user.account_type });
      rows.push({ name: q.name, code: q.code, rate: q.changeRate, price: q.price, group: p.group });
    } catch { rows.push({ name: h.name, code: h.code }); }
  }

  const holdingLines = rows.map((r) => `- ${r.name}${r.rate != null ? ` ${r.rate > 0 ? "+" : ""}${r.rate}% (${r.price?.toLocaleString()}원)` : ""}${pension && r.group ? ` [${r.group === "100" ? "안전자산" : "위험자산"}]` : ""}`);
  const eventLines = events.map((e) => `- ${e.at.slice(11)} ${e.title}`);

  const format = pension
    ? [
        "1) 오늘 시황 세 줄 — 미국 증시, 환율·금리, 국내 장 전망 중 오늘 중요한 것만",
        "2) 보유 종목 점검 — 비슷한 성격끼리 묶어서, 각 묶음마다 오늘의 이슈 한 줄과 참고 의견(유지 / 비중 확대 / 비중 축소) 한 줄. 의견에는 반드시 근거를 붙인다.",
        "3) 안전자산 확인 — 퇴직연금은 위험자산이 70%를 넘을 수 없다. 위 목록의 [안전자산] 표시를 보고 한쪽으로 치우쳤으면 짚어준다.",
        "4) 추가로 볼 만한 ETF 1~2개 — 보유 구성에서 빠진 성격을 채울 만한 것. 퇴직연금 매수 가능 여부(위험 70% / 안전 100%), 이유, 편입 비중 제안(70% 한도 안)을 적는다.",
        "5) 앞으로 2주 일정 — 보유 ETF 주요 구성종목 실적발표, FOMC·한은 금통위, 미국 물가·고용 발표, 분배금 기준일 중 검색으로 날짜를 확인한 것만. 날짜를 못 찾으면 빼고, 지어내지 않는다.",
      ].join("\n")
    : [
        "1) 오늘 시황 세 줄 — 미국 증시, 환율·금리, 국내 장 전망 중 오늘 중요한 것만",
        "2) 보유 종목 점검 — 비슷한 성격끼리 묶어서, 각 묶음마다 오늘의 이슈 한 줄과 참고 의견(유지 / 비중 확대 / 비중 축소) 한 줄. 의견에는 반드시 근거를 붙인다.",
        "3) 오늘 눈여겨볼 소식 한 가지",
        "4) 앞으로 2주 일정 — 보유 종목 실적발표, FOMC·한은 금통위, 미국 물가·고용 발표 중 검색으로 날짜를 확인한 것만.",
      ].join("\n");

  const prompt = [
    `${user.name}${user.honorific}께 아침에 보낼 투자 브리핑을 쓴다. 오늘은 ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}.`,
    `말투: ${user.tone}`,
    "",
    "구글 검색으로 오늘 아침 기준 최신 뉴스를 확인한 뒤 아래 양식으로 쓴다.",
    format,
    "",
    "규칙:",
    "- 첫 줄은 세 줄 요약이고, 알림에 그대로 뜨므로 120자 안쪽으로 짧게 쓴다.",
    "- 의견은 '참고 의견'이라고 밝히고 결정은 본인 몫이라고 한 줄 덧붙인다.",
    "- 주가가 오른다/내린다고 예측하지 않는다. 확인된 뉴스와 숫자만 쓴다.",
    "- 60대가 읽는다. 어려운 용어는 처음 나올 때 괄호로 푼다. 이모지는 쓰지 않는다.",
    "- 마크다운 소제목(##)과 글머리표를 쓰고 전체 1500자 안쪽.",
    "",
    rows.length ? "보유 종목(어제 종가 기준 등락):\n" + holdingLines.join("\n") : NO_HOLDINGS_NOTE,
    etfShareLine(user),
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
