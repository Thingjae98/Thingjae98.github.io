// 보유종목 사진 읽기: Gemini 가 잔고 화면을 목록으로 읽고, 종목명은 실제 종목코드로 맞춘다.
// 저장은 하지 않는다. 화면이 "이렇게 읽었습니다"를 보여주고, 사용자가 확인하면 /holdings/replace 로 교체한다.
import { searchSymbol } from "./quotes.js";
import { checkPension } from "./pension.js";

const PROMPT = [
  "이 사진은 증권사 앱의 잔고·보유종목 화면이거나 비중 표다. 보이는 그대로 JSON 하나로만 답한다. 설명 문장은 쓰지 않는다.",
  '형식: {"items":[{"name":"종목명 그대로","qty":수량 또는 null,"weight_pct":비중(%) 또는 null,"value":평가금액(원) 또는 null}],',
  ' "cash":[{"name":"예금·현금·MMF·RP·원리금보장 상품 이름","value":금액(원)}], "total_value":화면의 평가금액 합계(원) 또는 null}',
  "- 주식·ETF·펀드는 items 에, 예금·현금·원리금보장·MMF·RP 는 cash 에 넣는다.",
  "- 숫자는 쉼표 없이 숫자로. 화면에 없는 값은 null. 지어내지 않는다.",
  "- total_value 는 화면에 합계가 적혀 있을 때만. 없으면 null.",
].join("\n");

const num = (v) => (v == null || v === "" ? null : Number(String(v).replace(/[^\d.-]/g, "")) || null);

export async function readHoldingsPhoto(image, user, env) {
  const model = env.GEMINI_MODEL || "gemini-3.8-flash";
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: image.mimeType, data: image.data } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 8192, responseMimeType: "application/json" },
    }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`사진 읽기 실패(Gemini ${r.status}): ${j.error?.message || ""}`.slice(0, 200));
  const raw = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error("사진에서 목록을 읽지 못했습니다. 잔고 화면이 잘 보이게 다시 찍어 주세요."); }
  const usage = { in: j.usageMetadata?.promptTokenCount || 0, out: j.usageMetadata?.candidatesTokenCount || 0 };

  // 종목명 → 종목코드 (네이버 종목 검색 첫 결과)
  const items = await Promise.all((d.items || []).slice(0, 30).map(async (x) => {
    const read = String(x.name || "").trim();
    let hit = null;
    try { hit = read ? (await searchSymbol(read))[0] || null : null; } catch {}
    const pv = hit ? checkPension({ code: hit.code, name: hit.name, kind: hit.market?.includes("ETF") ? "etf" : undefined, accountType: user.account_type }) : null;
    return { read, code: hit?.code || null, name: hit?.name || read, qty: num(x.qty), weight_pct: num(x.weight_pct), value: num(x.value), group: pv?.group ?? null, matched: !!hit };
  }));
  const cash = (d.cash || []).map((c) => ({ name: String(c.name || "예금"), value: num(c.value) })).filter((c) => c.value);
  const cashTotal = cash.reduce((s, c) => s + c.value, 0);
  const itemsTotal = items.reduce((s, x) => s + (x.value || 0), 0);
  // 합계가 화면에 없으면, 종목 평가금액이 모두 있을 때만 종목+예금으로 합계를 만든다
  const total = num(d.total_value) || (items.length && items.every((x) => x.value) ? itemsTotal + cashTotal : null);
  return { items, cash, cash_total: cashTotal, total_value: total, usage };
}
