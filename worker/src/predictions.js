// 전망 적중 기록 (관리자 전용). 사용자에게는 보이지 않는다.
// AI 가 답 끝에 붙인 ```outlook [...]``` 블록을 떼어 저장하고, 14일 뒤 묶음 평균 수익률로 채점한다.
import { getQuote, prevDay } from "./quotes.js";

const VIEW = { up: "up", down: "down", flat: "flat", "반등 우세": "up", "하락 우세": "down", "횡보": "flat" };
const HORIZON_DAYS = 14, BAND = 2; // 14일 뒤, ±2% 안이면 횡보
const kstNow = () => new Date(Date.now() + 9 * 3600e3);
const kstStr = (d) => d.toISOString().slice(0, 16).replace("T", " ");

/** 답에서 기록용 블록을 떼어낸다. @returns {{text:string, items:Array}} */
export function extractOutlook(text) {
  if (typeof text !== "string") return { text, items: [] };
  const m = text.match(/```outlook\s*([\s\S]*?)```/);
  if (!m) return { text, items: [] };
  let items = [];
  try {
    items = (JSON.parse(m[1]) || []).map((x) => ({
      grp: String(x.group || "").slice(0, 40),
      codes: (x.codes || []).map(String).filter((c) => /^[0-9A-Z]{6}$/.test(c)).slice(0, 6),
      view: VIEW[x.view],
      confidence: ["low", "mid", "high"].includes(x.confidence) ? x.confidence : null,
      action: ["add", "hold", "reduce"].includes(x.action) ? x.action : null,
    })).filter((x) => x.grp && x.codes.length && x.view).slice(0, 8);
  } catch {}
  return { text: (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim(), items };
}

/** 전망을 저장한다. 기준가는 장중이면 현재가, 아니면 전 거래일 종가 */
export async function savePredictions(env, userId, source, items) {
  const now = kstNow(), due = new Date(now.getTime() + HORIZON_DAYS * 86400e3);
  for (const it of items) {
    const base = {};
    await Promise.all(it.codes.map(async (c) => {
      try {
        const q = await getQuote(c, env);
        base[c] = q.marketStatus === "OPEN" ? q.price : ((await prevDay(c).catch(() => null))?.close ?? q.price);
      } catch {}
    }));
    const codes = Object.keys(base);
    if (!codes.length) continue;
    await env.DB.prepare("INSERT INTO predictions (user_id, source, made_at, grp, codes, view, confidence, action, base, due_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
      .bind(userId, source, kstStr(now), it.grp, codes.join(","), it.view, it.confidence, it.action, JSON.stringify(base), kstStr(due).slice(0, 10)).run();
  }
}

/** 기한이 된 전망을 채점한다. 장 마감 뒤(16시~)에만, 한 번에 5건 */
export async function scorePredictions(env) {
  const now = kstNow();
  if (now.getUTCHours() < 16) return;
  const due = (await env.DB.prepare("SELECT * FROM predictions WHERE eval_at IS NULL AND due_at <= ? ORDER BY id LIMIT 5").bind(kstStr(now).slice(0, 10)).all()).results;
  for (const p of due) {
    const base = JSON.parse(p.base), rets = [];
    for (const c of Object.keys(base)) {
      try { const q = await getQuote(c, env); if (q.price && base[c]) rets.push((q.price / base[c] - 1) * 100); } catch {}
    }
    if (!rets.length) continue; // 시세를 못 받으면 다음에 다시
    const ret = Math.round((rets.reduce((a, b) => a + b, 0) / rets.length) * 100) / 100;
    const actual = ret > BAND ? "up" : ret < -BAND ? "down" : "flat";
    await env.DB.prepare("UPDATE predictions SET eval_at=?, ret=?, actual=?, hit=? WHERE id=?").bind(kstStr(now), ret, actual, actual === p.view ? 1 : 0, p.id).run();
  }
}

/** 관리 탭용 적중률 요약 */
export async function predictionStats(env) {
  const db = env.DB;
  const total = await db.prepare("SELECT COUNT(*) n, SUM(hit) h FROM predictions WHERE eval_at IS NOT NULL").first();
  const pending = await db.prepare("SELECT COUNT(*) n, MIN(due_at) next FROM predictions WHERE eval_at IS NULL").first();
  const byView = (await db.prepare("SELECT view k, COUNT(*) n, SUM(hit) h FROM predictions WHERE eval_at IS NOT NULL GROUP BY view").all()).results;
  const byConf = (await db.prepare("SELECT COALESCE(confidence,'-') k, COUNT(*) n, SUM(hit) h FROM predictions WHERE eval_at IS NOT NULL GROUP BY confidence").all()).results;
  const recent = (await db.prepare("SELECT p.made_at, u.name, p.grp, p.view, p.confidence, p.ret, p.actual, p.hit FROM predictions p JOIN users u ON u.id=p.user_id WHERE eval_at IS NOT NULL ORDER BY p.id DESC LIMIT 15").all()).results;
  return { horizon_days: HORIZON_DAYS, band_pct: BAND, total, pending, by_view: byView, by_confidence: byConf, recent };
}
