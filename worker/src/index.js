import { chat as geminiChat } from "./gemini.js";
import { checkPension, riskRatio, pensionRuleText } from "./pension.js";
import { searchSymbol, getQuote } from "./quotes.js";
import { sendPush } from "./push.js";

const QUIET_FROM = 22, QUIET_TO = 7, DAILY_PUSH_CAP = 10, SESSION_DAYS = 30;

// ---------- 공통 ----------
const kst = (d = new Date()) => new Date(d.getTime() + 9 * 3600e3);
const kstStr = (d = new Date()) => kst(d).toISOString().slice(0, 16).replace("T", " "); // YYYY-MM-DD HH:MM
const cors = (origin) => ({ "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS", Vary: "Origin" });
const json = (data, status, origin) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) } });
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hashPin(handle, pin) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("fa:" + handle), iterations: 100000 }, key, 256));
}

async function auth(req, env) {
  const t = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!t) return null;
  return (await env.DB.prepare("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires_at > datetime('now')").bind(t).first()) || null;
}

// ---------- 도구 실행(사용자 문맥) ----------
async function resolveSymbol(query) {
  if (/^\d{6}$/.test(query)) return { code: query };
  const hits = await searchSymbol(query);
  if (!hits.length) throw new Error(`'${query}' 종목을 찾지 못했습니다`);
  return hits[0];
}

async function quoteWithPension(query, env) {
  const s = await resolveSymbol(query);
  const q = await getQuote(s.code, env);
  return { ...q, pension: checkPension({ code: q.code, name: q.name, kind: q.kind }) };
}

async function holdingsWithPrices(user, env) {
  const rows = (await env.DB.prepare("SELECT id, code, name, qty, avg_price FROM holdings WHERE user_id=? ORDER BY id").bind(user.id).all()).results;
  const priced = [];
  for (const h of rows) {
    let price = h.avg_price;
    if (h.code) { try { price = (await getQuote(h.code, env)).price; } catch {} }
    priced.push({ ...h, price, value: price ? price * h.qty : null });
  }
  const rr = riskRatio(priced, user.total_balance);
  return { holdings: priced, total_balance: user.total_balance, risk_value: rr.risk, risk_ratio_pct: rr.ratio };
}

function makeToolRunner(user, env) {
  const db = env.DB;
  return async (name, a) => {
    switch (name) {
      case "get_quote": return quoteWithPension(a.query, env);
      case "simulate_buy": {
        const q = await quoteWithPension(a.query, env);
        if (q.pension.verdict === "불가") return { pension: q.pension, note: "매수 불가 종목이라 비중 계산 생략" };
        const cur = await holdingsWithPrices(user, env);
        const after = riskRatio(cur.holdings, user.total_balance, { code: q.code, name: q.name, qty: a.qty, price: q.price });
        return { quote: q, before_pct: cur.risk_ratio_pct, after_pct: after.ratio, limit_pct: 70, total_balance: user.total_balance, note: user.total_balance ? null : "전체 적립금을 모르면 비중을 못 냅니다. 사용자에게 적립금을 물어보고 set_total_balance 로 저장하세요." };
      }
      case "list_holdings": return holdingsWithPrices(user, env);
      case "set_holding": {
        const s = await resolveSymbol(a.query);
        const q = await getQuote(s.code, env).catch(() => ({ code: s.code, name: s.name || a.query }));
        if (a.qty <= 0) { await db.prepare("DELETE FROM holdings WHERE user_id=? AND code=?").bind(user.id, q.code).run(); return { deleted: q.name }; }
        const ex = await db.prepare("SELECT id FROM holdings WHERE user_id=? AND code=?").bind(user.id, q.code).first();
        if (ex) await db.prepare("UPDATE holdings SET qty=?, avg_price=COALESCE(?, avg_price), updated_at=datetime('now','localtime') WHERE id=?").bind(a.qty, a.avg_price ?? null, ex.id).run();
        else await db.prepare("INSERT INTO holdings (user_id, code, name, qty, avg_price) VALUES (?,?,?,?,?)").bind(user.id, q.code, q.name, a.qty, a.avg_price ?? null).run();
        return { saved: { code: q.code, name: q.name, qty: a.qty, avg_price: a.avg_price ?? null } };
      }
      case "set_total_balance":
        await db.prepare("UPDATE users SET total_balance=? WHERE id=?").bind(a.amount, user.id).run();
        user.total_balance = a.amount;
        return { total_balance: a.amount };
      case "add_trade": {
        const s = await resolveSymbol(a.query);
        const name = s.name || (await getQuote(s.code, env).catch(() => ({ name: a.query }))).name;
        const date = a.trade_date || kstStr().slice(0, 10);
        await db.prepare("INSERT INTO trades (user_id, trade_date, code, name, side, qty, price, reason, target_price, stop_price) VALUES (?,?,?,?,?,?,?,?,?,?)")
          .bind(user.id, date, s.code, name, a.side, a.qty, a.price, a.reason ?? null, a.target_price ?? null, a.stop_price ?? null).run();
        return { saved: { date, name, side: a.side, qty: a.qty, price: a.price } };
      }
      case "list_trades": {
        const from = a.from || "0000-00-00", to = a.to || "9999-12-31";
        return { trades: (await db.prepare("SELECT id, trade_date, code, name, side, qty, price, reason, target_price, stop_price FROM trades WHERE user_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date, id").bind(user.id, from, to).all()).results };
      }
      case "add_event": {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(a.start_at || "")) throw new Error("start_at 은 'YYYY-MM-DD HH:MM' 형식이어야 합니다");
        const r = await db.prepare("INSERT INTO events (user_id, title, start_at, repeat, remind_min) VALUES (?,?,?,?,?)").bind(user.id, a.title, a.start_at, a.repeat || "none", a.remind_min ?? 30).run();
        return { saved: { id: r.meta.last_row_id, title: a.title, start_at: a.start_at, repeat: a.repeat || "none", remind_min: a.remind_min ?? 30 } };
      }
      case "list_events": return { now: kstStr(), events: await upcomingEvents(user.id, a.days || 7, env) };
      case "delete_event": await db.prepare("DELETE FROM events WHERE id=? AND user_id=?").bind(a.id, user.id).run(); return { deleted: a.id };
      case "save_memory": await db.prepare("INSERT INTO memories (user_id, content) VALUES (?,?)").bind(user.id, a.content).run(); return { saved: a.content };
      default: throw new Error("unknown tool " + name);
    }
  };
}

// 반복 일정을 fromStr 부터 days일 안의 실제 발생 시각으로 펼친다 (KST 문자열을 UTC처럼 취급해 산술만)
function nextOccurrences(ev, fromStr, days) {
  const out = [];
  const from = new Date(fromStr.replace(" ", "T") + ":00Z");
  const end = new Date(from.getTime() + days * 86400e3);
  let t = new Date(ev.start_at.replace(" ", "T") + ":00Z");
  const step = ev.repeat === "daily" ? 86400e3 : ev.repeat === "weekly" ? 7 * 86400e3 : 0;
  if (step && t < from) t = new Date(t.getTime() + Math.ceil((from - t) / step) * step);
  while (t <= end) {
    if (t >= from) out.push(t.toISOString().slice(0, 16).replace("T", " "));
    if (!step) break;
    t = new Date(t.getTime() + step);
  }
  return out;
}

async function upcomingEvents(userId, days, env) {
  const rows = (await env.DB.prepare("SELECT id, title, start_at, repeat, remind_min FROM events WHERE user_id=?").bind(userId).all()).results;
  const now = kstStr();
  const list = [];
  for (const ev of rows) for (const at of nextOccurrences(ev, now, days)) list.push({ id: ev.id, title: ev.title, at, repeat: ev.repeat, remind_min: ev.remind_min });
  return list.sort((x, y) => x.at.localeCompare(y.at));
}

// ---------- 시스템 프롬프트 ----------
async function buildSystem(user, env) {
  const mem = (await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY id DESC LIMIT 40").bind(user.id).all()).results.map((m) => "- " + m.content).join("\n");
  const hold = (await env.DB.prepare("SELECT name, code, qty, avg_price FROM holdings WHERE user_id=?").bind(user.id).all()).results
    .map((h) => `- ${h.name}(${h.code || "코드없음"}) ${h.qty}주${h.avg_price ? ", 평단 " + h.avg_price.toLocaleString() + "원" : ""}`).join("\n");
  return [
    `당신의 이름은 '${user.agent_name}'. ${user.name}${user.honorific}의 개인 비서다. 지금은 한국시간 ${kstStr()}.`,
    `말투: ${user.tone}. 사용자를 부를 때는 '${user.name}${user.honorific}'.`,
    "역할: 퇴직연금(DC/IRP) 계좌로 ETF를 매매하는 사용자의 리서치·복기·규정 점검·일정 관리 비서. 탁구와 성당 활동을 즐기는 분이니 그 맥락을 안다.",
    "절대 규칙:",
    "- 주문을 실행하거나 실행한 척하지 않는다. 매매는 사용자가 증권사 앱에서 직접 한다.",
    "- 특정 종목을 사라/팔라고 단정하지 않는다. 판단 재료(시세·규정·뉴스·본인 매매기록)를 정리해 주고 결정은 사용자에게 둔다.",
    "- 종목 이야기가 나오면 get_quote 로 현재가와 퇴직연금 투자가능 여부를 확인하고, 판정 근거(어느 표·어느 규정)를 한 줄 붙인다. 불가 종목이면 먼저 알린다.",
    "- 규정·세금 답변에는 '최종 확인은 증권사 앱/세무사' 문구를 붙인다. 모르면 모른다고 한다. 숫자를 지어내지 않는다.",
    "- 사용자가 매수·매도했다고 말하면 add_trade 로 기록하고, 이유·목표가·손절선을 한 번만 가볍게 묻는다(강요하지 않는다). 보유 수량도 set_holding 으로 맞춘다.",
    "- 사용자가 투자 원칙·선호·관심사를 말하면 save_memory 로 저장한다.",
    "- 일정을 말하면 add_event 로 저장하고 알림 시각을 확인해 준다.",
    "- 증권사 앱 캡처 이미지를 받으면 종목·수량·평단·평가금액을 읽어 정리하고, 보유 목록에 반영할지 묻는다.",
    "- 답은 짧게. 표가 필요하면 마크다운 표. 이모지는 쓰지 않는다.",
    "",
    pensionRuleText(),
    "",
    "사용자에 대해 기억하는 것:", mem || "(아직 없음)",
    "",
    "보유 종목:", hold || "(등록된 것 없음)",
    user.total_balance ? `퇴직연금 전체 적립금: ${user.total_balance.toLocaleString()}원` : "퇴직연금 전체 적립금: 미입력(비중 계산 전에 물어볼 것)",
  ].join("\n");
}

const pub = (u) => ({ id: u.id, handle: u.handle, name: u.name, agent_name: u.agent_name, honorific: u.honorific, tone: u.tone, push_enabled: !!u.push_enabled, total_balance: u.total_balance });

async function newSession(u, env) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  const exp = new Date(Date.now() + SESSION_DAYS * 86400e3).toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)").bind(token, u.id, exp).run();
  return { token, user: pub(u) };
}

async function handleChat(user, body, env) {
  const text = (body.text || "").trim();
  const image = body.image; // { mimeType, data(base64) }
  if (!text && !image) throw new Error("내용이 없습니다");
  const hist = (await env.DB.prepare("SELECT role, content FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 24").bind(user.id).all()).results.reverse()
    .map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
  const userParts = [];
  if (image) userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  userParts.push({ text: text || "이 이미지를 읽어 정리해 주세요." });
  const system = await buildSystem(user, env);
  const r = await geminiChat({ system, history: hist, userParts, runTool: makeToolRunner(user, env), env });
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (user_id, role, content, has_image) VALUES (?,?,?,?)").bind(user.id, "user", text || "(이미지)", image ? 1 : 0),
    env.DB.prepare("INSERT INTO messages (user_id, role, content) VALUES (?,?,?)").bind(user.id, "model", r.text),
    env.DB.prepare("INSERT INTO usage_log (user_id, in_tokens, out_tokens) VALUES (?,?,?)").bind(user.id, r.usage.in, r.usage.out),
  ]);
  return { reply: r.text, tools: r.calls };
}

// ---------- 라우터 ----------
export default {
  async fetch(req, env) {
    const origin = env.ALLOWED_ORIGIN;
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(req.url);
    const p = url.pathname;
    const body = req.method === "GET" || req.method === "DELETE" ? {} : await req.json().catch(() => ({}));
    try {
      if (p === "/auth/register" && req.method === "POST") {
        const { handle, pin } = body;
        if (!/^\d{4}$/.test(pin || "")) return json({ error: "PIN은 숫자 4자리입니다" }, 400, origin);
        const u = await env.DB.prepare("SELECT * FROM users WHERE handle=?").bind((handle || "").trim().toUpperCase()).first();
        if (!u) return json({ error: "초대 코드를 찾을 수 없습니다" }, 404, origin);
        if (u.pin_hash) return json({ error: "이미 등록된 코드입니다. 로그인으로 들어가세요" }, 409, origin);
        await env.DB.prepare("UPDATE users SET pin_hash=? WHERE id=?").bind(await hashPin(u.handle, pin), u.id).run();
        return json(await newSession(u, env), 200, origin);
      }
      if (p === "/auth/login" && req.method === "POST") {
        const { handle, pin } = body;
        const u = await env.DB.prepare("SELECT * FROM users WHERE handle=?").bind((handle || "").trim().toUpperCase()).first();
        if (!u || !u.pin_hash) return json({ error: "코드를 찾을 수 없습니다" }, 404, origin);
        if ((await hashPin(u.handle, pin || "")) !== u.pin_hash) return json({ error: "PIN이 맞지 않습니다" }, 401, origin);
        return json(await newSession(u, env), 200, origin);
      }
      if (p === "/push/vapid") return json({ key: env.VAPID_PUBLIC }, 200, origin);

      const user = await auth(req, env);
      if (!user) return json({ error: "로그인이 필요합니다" }, 401, origin);
      const db = env.DB;
      const idOf = (prefix) => Number(p.slice(prefix.length));

      if (p === "/me" && req.method === "GET") return json(pub(user), 200, origin);
      if (p === "/me" && req.method === "PATCH") {
        const allowed = ["agent_name", "honorific", "tone", "push_enabled", "total_balance", "name"];
        const sets = [], vals = [];
        for (const k of allowed) if (k in body) { sets.push(`${k}=?`); vals.push(k === "push_enabled" ? (body[k] ? 1 : 0) : body[k]); }
        if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).bind(...vals, user.id).run();
        return json(pub(await db.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first()), 200, origin);
      }
      if (p === "/auth/logout" && req.method === "POST") { await db.prepare("DELETE FROM sessions WHERE token=?").bind(req.headers.get("Authorization").slice(7)).run(); return json({ ok: true }, 200, origin); }

      if (p === "/chat" && req.method === "POST") return json(await handleChat(user, body, env), 200, origin);
      if (p === "/messages" && req.method === "GET") {
        const before = Number(url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER;
        const rows = (await db.prepare("SELECT id, role, content, has_image, created_at FROM messages WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 40").bind(user.id, before).all()).results.reverse();
        return json({ messages: rows }, 200, origin);
      }
      if (p === "/messages" && req.method === "DELETE") { await db.prepare("DELETE FROM messages WHERE user_id=?").bind(user.id).run(); return json({ ok: true }, 200, origin); }

      if (p === "/holdings" && req.method === "GET") return json(await holdingsWithPrices(user, env), 200, origin);
      if (p.startsWith("/holdings/") && req.method === "DELETE") { await db.prepare("DELETE FROM holdings WHERE id=? AND user_id=?").bind(idOf("/holdings/"), user.id).run(); return json({ ok: true }, 200, origin); }
      if (p === "/trades" && req.method === "GET") return json({ trades: (await db.prepare("SELECT * FROM trades WHERE user_id=? ORDER BY trade_date DESC, id DESC LIMIT 200").bind(user.id).all()).results }, 200, origin);
      if (p.startsWith("/trades/") && req.method === "DELETE") { await db.prepare("DELETE FROM trades WHERE id=? AND user_id=?").bind(idOf("/trades/"), user.id).run(); return json({ ok: true }, 200, origin); }
      if (p === "/events" && req.method === "GET") return json({ upcoming: await upcomingEvents(user.id, 30, env), all: (await db.prepare("SELECT * FROM events WHERE user_id=? ORDER BY start_at").bind(user.id).all()).results }, 200, origin);
      if (p === "/events" && req.method === "POST") return json(await makeToolRunner(user, env)("add_event", body), 200, origin);
      if (p.startsWith("/events/") && req.method === "DELETE") { await db.prepare("DELETE FROM events WHERE id=? AND user_id=?").bind(idOf("/events/"), user.id).run(); return json({ ok: true }, 200, origin); }
      if (p === "/memories" && req.method === "GET") return json({ memories: (await db.prepare("SELECT * FROM memories WHERE user_id=? ORDER BY id DESC").bind(user.id).all()).results }, 200, origin);
      if (p.startsWith("/memories/") && req.method === "DELETE") { await db.prepare("DELETE FROM memories WHERE id=? AND user_id=?").bind(idOf("/memories/"), user.id).run(); return json({ ok: true }, 200, origin); }

      if (p === "/push/subscribe" && req.method === "POST") {
        const { endpoint, keys } = body;
        if (!endpoint || !keys?.p256dh || !keys?.auth) return json({ error: "구독 정보가 없습니다" }, 400, origin);
        await db.prepare("INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth").bind(user.id, endpoint, keys.p256dh, keys.auth).run();
        return json({ ok: true }, 200, origin);
      }
      if (p === "/push/subscribe" && req.method === "DELETE") { await db.prepare("DELETE FROM push_subs WHERE user_id=?").bind(user.id).run(); return json({ ok: true }, 200, origin); }
      if (p === "/push/test" && req.method === "POST") {
        const subs = (await db.prepare("SELECT * FROM push_subs WHERE user_id=?").bind(user.id).all()).results;
        const sent = [];
        for (const s of subs) sent.push(await sendPush(s, { title: user.agent_name, body: "알림 테스트입니다. 잘 도착했습니다.", url: "/" }, env));
        return json({ sent }, 200, origin);
      }
      return json({ error: "not found" }, 404, origin);
    } catch (e) {
      return json({ error: String(e.message || e) }, 500, origin);
    }
  },

  // 매분: 다가오는 일정 알림. 야간 무음 22~07시, 사용자별 하루 10건 상한, push_enabled 사용자만
  async scheduled(_ev, env) {
    const h = kst().getUTCHours();
    if (h >= QUIET_FROM || h < QUIET_TO) return;
    const now = kstStr();
    const users = (await env.DB.prepare("SELECT * FROM users WHERE push_enabled=1").all()).results;
    for (const u of users) {
      const sentToday = (await env.DB.prepare("SELECT COUNT(*) c FROM push_log WHERE user_id=? AND sent_at >= date('now','localtime')").bind(u.id).first()).c;
      if (sentToday >= DAILY_PUSH_CAP) continue;
      const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE user_id=?").bind(u.id).all()).results;
      if (!subs.length) continue;
      const evs = (await env.DB.prepare("SELECT * FROM events WHERE user_id=?").bind(u.id).all()).results;
      for (const ev of evs) {
        const occ = nextOccurrences(ev, now, 2)[0];
        if (!occ || ev.last_notified === occ) continue;
        const minsLeft = (new Date(occ.replace(" ", "T") + ":00Z") - new Date(now.replace(" ", "T") + ":00Z")) / 60000;
        if (minsLeft > ev.remind_min) continue;
        const payload = { title: `${ev.title} ${minsLeft <= 0 ? "지금" : Math.round(minsLeft) + "분 후"}`, body: occ.slice(5).replace("-", "/") + (ev.repeat !== "none" ? " (반복 일정)" : ""), url: "/#events" };
        for (const s of subs) { const r = await sendPush(s, payload, env); if (r.gone) await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(s.id).run(); }
        await env.DB.prepare("UPDATE events SET last_notified=? WHERE id=?").bind(occ, ev.id).run();
        await env.DB.prepare("INSERT INTO push_log (user_id, title) VALUES (?,?)").bind(u.id, payload.title).run();
      }
    }
  },
};
