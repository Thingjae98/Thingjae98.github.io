// 아침 브리핑: 보유 종목 등락 + 오늘 일정 + 한 줄 시장 요약. 하루 1회, 켠 사람에게만.
import { getQuote } from "./quotes.js";

/** 사용자 한 명의 브리핑 본문을 만든다. LLM 한 번만 쓴다(비용 최소). */
export async function buildBrief(user, env, deps) {
  const { holdings, events } = deps;
  const lines = [];

  const moved = [];
  for (const h of holdings) {
    if (!h.code) continue;
    try {
      const q = await getQuote(h.code, env);
      moved.push({ name: q.name, rate: q.changeRate, price: q.price });
    } catch {}
  }
  moved.sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));
  if (moved.length) {
    lines.push("보유 종목 어제 등락:");
    for (const m of moved.slice(0, 5)) lines.push(`- ${m.name} ${m.rate > 0 ? "+" : ""}${m.rate}% (${m.price.toLocaleString()}원)`);
  }
  if (events.length) {
    lines.push("오늘 일정:");
    for (const e of events) lines.push(`- ${e.at.slice(11)} ${e.title}`);
  }
  if (!lines.length) return null;

  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const prompt = [
    `${user.name}${user.honorific}께 보낼 아침 알림 문구를 만든다.`,
    `말투: ${user.tone}`,
    "규칙: 두세 문장, 120자 이내. 오늘 국내 증시에서 눈여겨볼 점 한 가지를 검색해 덧붙인다.",
    "매수·매도를 권하지 않는다. 인사말은 짧게. 이모지 금지.",
    "",
    lines.join("\n"),
  ].join("\n");

  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 400 },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || ""}`);
  const text = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  return {
    text: text || lines.join("\n"),
    detail: lines.join("\n"),
    usage: { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 },
  };
}
