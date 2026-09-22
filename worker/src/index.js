import { chat as geminiChat } from "./gemini.js";
import { checkPension, riskRatio, pensionRuleText, searchEtf } from "./pension.js";
import { searchSymbol, getQuote } from "./quotes.js";
import { sendPush } from "./push.js";
import { getFinance, getKeyMetrics } from "./finance.js";
import { analyzeStyle, riskProfile } from "./profile.js";
import { buildBrief } from "./brief.js";

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

async function quoteWithPension(query, env, accountType = "pension") {
  const s = await resolveSymbol(query);
  const q = await getQuote(s.code, env);
  return { ...q, pension: checkPension({ code: q.code, name: q.name, kind: q.kind, accountType }) };
}

async function holdingsWithPrices(user, env) {
  const rows = (await env.DB.prepare("SELECT id, code, name, qty, avg_price, weight_pct FROM holdings WHERE user_id=? ORDER BY id").bind(user.id).all()).results;
  const priced = [];
  for (const h of rows) {
    let price = h.avg_price;
    if (h.code) { try { price = (await getQuote(h.code, env)).price; } catch {} }
    const value = h.qty && price ? price * h.qty : (h.weight_pct && user.total_balance ? Math.round((h.weight_pct / 100) * user.total_balance) : null);
    priced.push({ ...h, price, value });
  }
  const rr = riskRatio(priced, user.total_balance);
  return { holdings: priced, total_balance: user.total_balance, risk_value: rr.risk, risk_ratio_pct: rr.ratio };
}

function makeToolRunner(user, env, ctx = {}) {
  const db = env.DB;
  return async (name, a) => {
    switch (name) {
      case "get_quote": return quoteWithPension(a.query, env, user.account_type);
      case "simulate_buy": {
        const q = await quoteWithPension(a.query, env, user.account_type);
        if (q.pension.verdict === "불가") return { pension: q.pension, note: "매수 불가 종목이라 비중 계산 생략" };
        const cur = await holdingsWithPrices(user, env);
        const after = riskRatio(cur.holdings, user.total_balance, { code: q.code, name: q.name, qty: a.qty, price: q.price });
        return { quote: q, before_pct: cur.risk_ratio_pct, after_pct: after.ratio, limit_pct: 70, total_balance: user.total_balance, note: user.total_balance ? null : "전체 적립금을 모르면 비중을 못 냅니다. 사용자에게 적립금을 물어보고 set_total_balance 로 저장하세요." };
      }
      case "list_holdings": return holdingsWithPrices(user, env);
      case "set_holding": {
        const s = await resolveSymbol(a.query);
        const q = await getQuote(s.code, env).catch(() => ({ code: s.code, name: s.name || a.query }));
        const hasQty = a.qty != null && a.qty > 0;
        const hasWeight = a.weight_pct != null && a.weight_pct > 0;
        if (!hasQty && !hasWeight && a.qty === 0) { await db.prepare("DELETE FROM holdings WHERE user_id=? AND code=?").bind(user.id, q.code).run(); return { deleted: q.name }; }
        if (!hasQty && !hasWeight) throw new Error("수량이나 비중(%) 중 하나는 있어야 합니다");
        const ex = await db.prepare("SELECT id FROM holdings WHERE user_id=? AND code=?").bind(user.id, q.code).first();
        if (ex) await db.prepare("UPDATE holdings SET qty=COALESCE(?, qty), avg_price=COALESCE(?, avg_price), weight_pct=COALESCE(?, weight_pct), updated_at=datetime('now','+9 hours') WHERE id=?")
          .bind(hasQty ? a.qty : null, a.avg_price ?? null, hasWeight ? a.weight_pct : null, ex.id).run();
        else await db.prepare("INSERT INTO holdings (user_id, code, name, qty, avg_price, weight_pct, updated_at) VALUES (?,?,?,?,?,?,datetime('now','+9 hours'))")
          .bind(user.id, q.code, q.name, hasQty ? a.qty : null, a.avg_price ?? null, hasWeight ? a.weight_pct : null).run();
        return { saved: { code: q.code, name: q.name, qty: hasQty ? a.qty : null, weight_pct: hasWeight ? a.weight_pct : null, avg_price: a.avg_price ?? null } };
      }
      case "set_total_balance":
        await db.prepare("UPDATE users SET total_balance=? WHERE id=?").bind(a.amount, user.id).run();
        user.total_balance = a.amount;
        return { total_balance: a.amount };
      case "add_trade": {
        const s = await resolveSymbol(a.query);
        const name = s.name || (await getQuote(s.code, env).catch(() => ({ name: a.query }))).name;
        const date = a.trade_date || kstStr().slice(0, 10);
        await db.prepare("INSERT INTO trades (user_id, trade_date, code, name, side, qty, price, reason, target_price, stop_price, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,datetime('now','+9 hours'))")
          .bind(user.id, date, s.code, name, a.side, a.qty, a.price, a.reason ?? null, a.target_price ?? null, a.stop_price ?? null).run();
        return { saved: { date, name, side: a.side, qty: a.qty, price: a.price } };
      }
      case "list_trades": {
        const from = a.from || "0000-00-00", to = a.to || "9999-12-31";
        return { trades: (await db.prepare("SELECT id, trade_date, code, name, side, qty, price, reason, target_price, stop_price FROM trades WHERE user_id=? AND trade_date BETWEEN ? AND ? ORDER BY trade_date, id").bind(user.id, from, to).all()).results };
      }
      case "add_event": {
        if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(a.start_at || "")) throw new Error("start_at 은 'YYYY-MM-DD HH:MM' 형식이어야 합니다");
        const r = await db.prepare("INSERT INTO events (user_id, title, start_at, repeat, remind_min, created_at) VALUES (?,?,?,?,?,datetime('now','+9 hours'))").bind(user.id, a.title, a.start_at, a.repeat || "none", a.remind_min ?? 30).run();
        return { saved: { id: r.meta.last_row_id, title: a.title, start_at: a.start_at, repeat: a.repeat || "none", remind_min: a.remind_min ?? 30 } };
      }
      case "list_events": return { now: kstStr(), events: await upcomingEvents(user.id, a.days || 7, env) };
      case "delete_event": await db.prepare("DELETE FROM events WHERE id=? AND user_id=?").bind(a.id, user.id).run(); return { deleted: a.id };
      case "save_memory": await db.prepare("INSERT INTO memories (user_id, content, created_at) VALUES (?,?,datetime('now','+9 hours'))").bind(user.id, a.content).run(); return { saved: a.content };
      case "get_financials": {
        const s = await resolveSymbol(a.query);
        const [fin, met] = await Promise.all([
          getFinance(s.code, a.period === "quarter" ? "quarter" : "annual").catch((e) => ({ error: String(e.message || e) })),
          getKeyMetrics(s.code).catch((e) => ({ error: String(e.message || e) })),
        ]);
        return { financials: fin, key_metrics: met };
      }
      case "my_style": {
        const rows = (await db.prepare("SELECT trade_date, code, name, side, qty, price, target_price, stop_price FROM trades WHERE user_id=? ORDER BY trade_date, id").bind(user.id).all()).results;
        return analyzeStyle(rows);
      }
      case "risk_profile": {
        const sym = await resolveSymbol(a.query);
        const [rp, q] = await Promise.all([
          riskProfile(sym.code).catch((e) => ({ error: String(e.message || e) })),
          quoteWithPension(a.query, env, user.account_type).catch(() => null),
        ]);
        return { quote: q, risk: rp };
      }
      case "deep_research": {
        const r = await db.prepare("INSERT INTO jobs (user_id, prompt, context) VALUES (?,?,?)")
          .bind(user.id, a.request, a.context ? String(a.context).slice(0, 4000) : null).run();
        ctx.job_id = r.meta.last_row_id;
        return { queued: true, job_id: r.meta.last_row_id, note: "시간이 걸리는 작업이라 뒤에서 처리합니다. 사용자에게 '준비되면 알려드리겠습니다' 정도로 한 줄만 답하세요. 결과를 지어내지 마세요." };
      }
      case "search_etf": return searchEtf({
        query: a.query || "", pensionOnly: user.account_type !== "general" ? a.pension_only !== false : false,
        safeOnly: !!a.safe_only, asset: a.asset || null, limit: a.limit || 12,
      });
      case "make_document": ctx.document = a; return { ok: true, note: "화면에서 파일로 만들어 사용자에게 내려줍니다. 답변에는 무엇을 만들었는지 한 줄만 적으세요." };
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
    "- 증권사 앱 캡처나 비중표 이미지를 받으면 종목과 수량 또는 비중(%)을 읽어 set_holding 으로 전부 등록한다. 수량이 없고 비중만 있으면 weight_pct 에 넣는다. 등록 후 무엇을 넣었는지 표로 보여준다.",
    "- 기업 분석·보고서를 요청받으면 get_financials 로 실제 재무 숫자를 먼저 가져온다. 숫자는 가져온 값만 쓰고 추정하지 않는다. 최신 소식은 구글 검색으로 보완한다.",
    "- '이 종목 어때', '안전한가', '오래 들고 갈까 짧게 볼까', '나한테 맞나' 류의 질문에는 my_style 과 risk_profile 을 함께 불러 본인 매매 습관과 종목 성격을 대조해 답한다. 예: '평소 2주쯤 들고 계시는데 이 종목은 변동성이 높아 그 기간에 손실 폭이 커질 수 있습니다.'",
    "- 주가가 오를지 내릴지는 단정하지 않는다. 증권사 목표주가 컨센서스는 '애널리스트 평균은 이렇다'고 인용만 하고, 맞는다는 보장이 없다고 덧붙인다.",
    "- 매매 기록이 적어 성향이 안 나오면 솔직히 말하고, 매매하실 때 말씀해 주시면 쌓인다고 안내한다.",
    "- '보고서로 만들어줘', 'PDF로', '발표자료로', 'PPT로' 같은 요청에는 make_document 를 부른다. 내용을 먼저 조사한 뒤 마지막에 부른다. 답변에는 무엇을 만들었는지 한 줄만 쓴다.",
    "- 여러 종목 비교, 업종 전반 조사, 포트폴리오 전체 점검처럼 시간이 걸리는 요청은 deep_research 에 맡긴다. 맡긴 뒤에는 결과를 지어내지 말고 준비되면 알려드리겠다고만 답한다.",
    "- 답은 짧게. 표가 필요하면 마크다운 표. 이모지는 쓰지 않는다.",
    "",
    pensionRuleText(user.account_type),
    "",
    "사용자에 대해 기억하는 것:", mem || "(아직 없음)",
    "",
    "보유 종목:", hold || "(등록된 것 없음)",
    user.total_balance ? `퇴직연금 전체 적립금: ${user.total_balance.toLocaleString()}원` : "퇴직연금 전체 적립금: 미입력(비중 계산 전에 물어볼 것)",
  ].join("\n");
}

// 아침 브리핑: 켠 사람에게 하루 1회, 설정한 시각(한국시간)에
async function runMorningBrief(env, hour, now) {
  const today = now.slice(0, 10);
  const users = (await env.DB.prepare("SELECT * FROM users WHERE brief_enabled=1 AND push_enabled=1 AND brief_hour=? AND (brief_last IS NULL OR brief_last<>?)").bind(hour, today).all()).results;
  for (const u of users) {
    await env.DB.prepare("UPDATE users SET brief_last=? WHERE id=?").bind(today, u.id).run(); // 먼저 표시해 중복 발송을 막는다
    try {
      const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE user_id=?").bind(u.id).all()).results;
      if (!subs.length) continue;
      const holdings = (await env.DB.prepare("SELECT code, name, qty FROM holdings WHERE user_id=?").bind(u.id).all()).results;
      const events = (await upcomingEvents(u.id, 1, env)).filter((e) => e.at.slice(0, 10) === today);
      const brief = await buildBrief(u, env, { holdings, events });
      if (!brief) continue;
      for (const sb of subs) {
        const r = await sendPush(sb, { title: `${u.agent_name} 아침 브리핑`, body: brief.short, url: "/#chat" }, env);
        if (r.gone) await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(sb.id).run();
      }
      await env.DB.batch([
        env.DB.prepare("INSERT INTO messages (user_id, role, content, created_at) VALUES (?,?,?,datetime('now','+9 hours'))").bind(u.id, "model", brief.text),
        env.DB.prepare("INSERT INTO push_log (user_id, title, sent_at) VALUES (?,?,datetime('now','+9 hours'))").bind(u.id, "아침 브리핑"),
        env.DB.prepare("INSERT INTO usage_log (user_id, in_tokens, out_tokens, created_at) VALUES (?,?,?,datetime('now','+9 hours'))").bind(u.id, brief.usage.in, brief.usage.out),
      ]);
    } catch (e) { /* 한 사람 실패가 다른 사람을 막지 않는다 */ }
  }
}

const pub = (u) => ({ id: u.id, handle: u.handle, name: u.name, agent_name: u.agent_name, honorific: u.honorific, tone: u.tone, push_enabled: !!u.push_enabled, total_balance: u.total_balance, is_admin: !!u.is_admin, account_type: u.account_type || 'pension', brief_enabled: !!u.brief_enabled, brief_hour: u.brief_hour ?? 8 });

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
  const mode = ["fast", "smart", "deep"].includes(body.mode) ? body.mode : "smart";

  // 깊게: LLM 을 거치지 않고 바로 로컬 PC 작업 대기줄로 넘긴다
  if (mode === "deep" && text) {
    const holdings = (await env.DB.prepare("SELECT name, code, qty, weight_pct FROM holdings WHERE user_id=?").bind(user.id).all()).results;
    const memos = (await env.DB.prepare("SELECT content FROM memories WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(user.id).all()).results;
    // 클로드 쪽에서는 네이버 금융에 직접 붙지 못하므로, 서버가 가진 확정 수치를 미리 실어 보낸다
    const detail = [];
    for (const h of holdings.slice(0, 12)) {
      if (!h.code) { detail.push(`- ${h.name}`); continue; }
      try {
        const q = await getQuote(h.code, env);
        const pv = checkPension({ code: q.code, name: q.name, kind: q.kind, accountType: user.account_type });
        detail.push(`- ${q.name}(${q.code}) 현재가 ${q.price?.toLocaleString()}원, 전일대비 ${q.changeRate}%`
          + (h.qty ? `, ${h.qty}주` : "") + (h.weight_pct ? `, 비중 ${h.weight_pct}%` : "")
          + (user.account_type === "general" ? "" : `, 퇴직연금 ${pv.verdict}${pv.group ? " " + pv.group + "%" : ""}`));
      } catch { detail.push(`- ${h.name}${h.weight_pct ? ` 비중 ${h.weight_pct}%` : ""}`); }
    }
    const ctxLines = [
      detail.length ? "보유 종목 (서버에서 방금 조회한 확정 수치):\n" + detail.join("\n") : "",
      user.total_balance ? `계좌 총액: ${user.total_balance.toLocaleString()}원` : "",
      memos.length ? "기억하는 것: " + memos.map((m) => m.content).join(" / ") : "",
      user.account_type === "general" ? "계좌: 일반 위탁계좌" : "계좌: 퇴직연금(DC/IRP). 개별주식·레버리지·인버스 매수 불가, 위험자산 70% 한도.",
      "위 수치는 확정된 값이니 그대로 쓰면 된다. 시세를 웹에서 다시 찾지 말 것. 뉴스·업황은 검색해도 좋다.",
    ].filter(Boolean).join("\n");
    const r = await env.DB.prepare("INSERT INTO jobs (user_id, prompt, context) VALUES (?,?,?)").bind(user.id, text, ctxLines || null).run();
    const reply = "깊이 알아보고 있습니다. 준비되면 알려드리겠습니다.";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO messages (user_id, role, content, has_image, created_at) VALUES (?,?,?,?,datetime('now','+9 hours'))").bind(user.id, "user", text, 0),
      env.DB.prepare("INSERT INTO messages (user_id, role, content, created_at) VALUES (?,?,?,datetime('now','+9 hours'))").bind(user.id, "model", reply),
    ]);
    return { reply, tools: [], document: null, job_id: r.meta.last_row_id };
  }
  const hist = (await env.DB.prepare("SELECT role, content FROM messages WHERE user_id=? ORDER BY id DESC LIMIT 24").bind(user.id).all()).results.reverse()
    .map((m) => ({ role: m.role, parts: [{ text: m.content }] }));
  const userParts = [];
  if (image) userParts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  userParts.push({ text: text || "이 이미지를 읽어 정리해 주세요." });
  const system = await buildSystem(user, env);
  const ctx = {};
  const r = await geminiChat({ system, history: hist, userParts, runTool: makeToolRunner(user, env, ctx), env, model: mode === "fast" ? (env.GEMINI_MODEL_FAST || "gemini-3.5-flash-lite") : undefined });
  const stmts = [env.DB.prepare("INSERT INTO usage_log (user_id, in_tokens, out_tokens, created_at) VALUES (?,?,?,datetime('now','+9 hours'))").bind(user.id, r.usage.in, r.usage.out)];
  if (body.keep_log !== false) {
    stmts.unshift(
      env.DB.prepare("INSERT INTO messages (user_id, role, content, has_image, created_at) VALUES (?,?,?,?,datetime('now','+9 hours'))").bind(user.id, "user", text || "(이미지)", image ? 1 : 0),
      env.DB.prepare("INSERT INTO messages (user_id, role, content, document, created_at) VALUES (?,?,?,?,datetime('now','+9 hours'))").bind(user.id, "model", r.text, ctx.document ? JSON.stringify(ctx.document) : null),
    );
  }
  await env.DB.batch(stmts);
  return { reply: r.text, tools: r.calls, document: ctx.document || null, job_id: ctx.job_id || null };
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

      // ---------- 작업 대기줄 (로컬 PC 작업자) ----------
      if (p.startsWith("/worker/")) {
        if ((req.headers.get("X-Worker-Key") || "") !== env.WORKER_KEY) return json({ error: "작업자 인증 실패" }, 403, origin);
        if (p === "/worker/claim" && req.method === "POST") {
          const job = await env.DB.prepare("SELECT * FROM jobs WHERE status='queued' ORDER BY id LIMIT 1").first();
          if (!job) return json({ job: null }, 200, origin);
          const upd = await env.DB.prepare("UPDATE jobs SET status='running', claimed_at=datetime('now','+9 hours') WHERE id=? AND status='queued'").bind(job.id).run();
          if (!upd.meta.changes) return json({ job: null }, 200, origin); // 다른 작업자가 먼저 가져감
          const u = await env.DB.prepare("SELECT name, honorific, tone, account_type FROM users WHERE id=?").bind(job.user_id).first();
          return json({ job: { id: job.id, prompt: job.prompt, context: job.context, user: u } }, 200, origin);
        }
        if (p === "/worker/result" && req.method === "POST") {
          const { job_id, result, error } = body;
          const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(job_id).first();
          if (!job) return json({ error: "없는 작업" }, 404, origin);
          await env.DB.prepare("UPDATE jobs SET status=?, result=?, error=?, finished_at=datetime('now','+9 hours') WHERE id=?")
            .bind(error ? "failed" : "done", result ?? null, error ?? null, job_id).run();
          const text = error ? `요청하신 분석을 마치지 못했습니다. (${String(error).slice(0, 200)})` : result;
          await env.DB.prepare("INSERT INTO messages (user_id, role, content, created_at) VALUES (?,?,?,datetime('now','+9 hours'))").bind(job.user_id, "model", text).run();
          const subs = (await env.DB.prepare("SELECT * FROM push_subs WHERE user_id=?").bind(job.user_id).all()).results;
          const u = await env.DB.prepare("SELECT agent_name, push_enabled FROM users WHERE id=?").bind(job.user_id).first();
          const hour = kst().getUTCHours();
          if (u?.push_enabled && hour >= QUIET_TO && hour < QUIET_FROM) {
            for (const s of subs) { const rr = await sendPush(s, { title: `${u.agent_name} 분석 완료`, body: String(text).slice(0, 120), url: "/#chat" }, env); if (rr.gone) await env.DB.prepare("DELETE FROM push_subs WHERE id=?").bind(s.id).run(); }
            await env.DB.prepare("INSERT INTO push_log (user_id, title, sent_at) VALUES (?,?,datetime('now','+9 hours'))").bind(job.user_id, "분석 완료").run();
          }
          return json({ ok: true }, 200, origin);
        }
        return json({ error: "not found" }, 404, origin);
      }


      const user = await auth(req, env);
      if (!user) return json({ error: "로그인이 필요합니다" }, 401, origin);
      const db = env.DB;
      const idOf = (prefix) => Number(p.slice(prefix.length));

      if (p === "/me" && req.method === "GET") return json(pub(user), 200, origin);
      if (p === "/me" && req.method === "PATCH") {
        const allowed = ["agent_name", "honorific", "tone", "push_enabled", "total_balance", "name", "brief_enabled", "brief_hour"];
        const sets = [], vals = [];
        for (const k of allowed) if (k in body) { sets.push(`${k}=?`); vals.push(k === "push_enabled" || k === "brief_enabled" ? (body[k] ? 1 : 0) : body[k]); }
        if (sets.length) await db.prepare(`UPDATE users SET ${sets.join(",")} WHERE id=?`).bind(...vals, user.id).run();
        return json(pub(await db.prepare("SELECT * FROM users WHERE id=?").bind(user.id).first()), 200, origin);
      }
      if (p === "/auth/logout" && req.method === "POST") { await db.prepare("DELETE FROM sessions WHERE token=?").bind(req.headers.get("Authorization").slice(7)).run(); return json({ ok: true }, 200, origin); }

      if (p === "/chat" && req.method === "POST") return json(await handleChat(user, body, env), 200, origin);
      if (p === "/messages" && req.method === "GET") {
        const before = Number(url.searchParams.get("before") || 0) || Number.MAX_SAFE_INTEGER;
        const rows = (await db.prepare("SELECT id, role, content, has_image, document, created_at FROM messages WHERE user_id=? AND id<? ORDER BY id DESC LIMIT 40").bind(user.id, before).all()).results.reverse();
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

      // ---------- 관리자 ----------
      if (p.startsWith("/admin/")) {
        if (!user.is_admin) return json({ error: "관리자만 쓸 수 있습니다" }, 403, origin);
        if (p === "/admin/users" && req.method === "GET") {
          const rows = (await db.prepare(
            `SELECT u.id, u.handle, u.name, u.account_type, u.is_admin, u.push_enabled, u.total_balance, u.created_at,
                    u.pin_hash IS NOT NULL AS registered,
                    (SELECT COUNT(*) FROM messages m WHERE m.user_id=u.id) AS msg_count,
                    (SELECT MAX(created_at) FROM messages m WHERE m.user_id=u.id) AS last_seen
             FROM users u ORDER BY u.id`).all()).results;
          return json({ users: rows.map((r) => ({ ...r, registered: !!r.registered, is_admin: !!r.is_admin, push_enabled: !!r.push_enabled })) }, 200, origin);
        }
        if (p === "/admin/users" && req.method === "POST") {
          const name = (body.name || "").trim();
          if (!name) return json({ error: "이름을 넣어주세요" }, 400, origin);
          const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
          let handle = "";
          for (let i = 0; i < 8; i++) {
            handle = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => A[b % A.length]).join("");
            if (!(await db.prepare("SELECT 1 FROM users WHERE handle=?").bind(handle).first())) break;
          }
          await db.prepare("INSERT INTO users (handle, name, account_type, created_at) VALUES (?,?,?,datetime('now','+9 hours'))")
            .bind(handle, name, body.account_type === "general" ? "general" : "pension").run();
          return json({ handle, name }, 200, origin);
        }
        const m = p.match(/^\/admin\/users\/(\d+)$/);
        if (m) {
          const uid = Number(m[1]);
          if (req.method === "PATCH") {
            if ("account_type" in body) await db.prepare("UPDATE users SET account_type=? WHERE id=?").bind(body.account_type === "general" ? "general" : "pension", uid).run();
            if ("name" in body) await db.prepare("UPDATE users SET name=? WHERE id=?").bind(String(body.name).trim(), uid).run();
            if (body.reset_pin) {
              await db.prepare("UPDATE users SET pin_hash=NULL WHERE id=?").bind(uid).run();
              await db.prepare("DELETE FROM sessions WHERE user_id=?").bind(uid).run();
            }
            return json({ ok: true }, 200, origin);
          }
          if (req.method === "DELETE") {
            if (uid === user.id) return json({ error: "자기 계정은 지울 수 없습니다" }, 400, origin);
            for (const t of ["sessions", "messages", "holdings", "trades", "memories", "events", "push_subs", "push_log", "usage_log"])
              await db.prepare(`DELETE FROM ${t} WHERE user_id=?`).bind(uid).run();
            await db.prepare("DELETE FROM users WHERE id=?").bind(uid).run();
            return json({ ok: true }, 200, origin);
          }
        }
        if (p === "/admin/usage" && req.method === "GET") {
          const byUser = (await db.prepare(
            `SELECT u.name, COUNT(l.id) AS calls, COALESCE(SUM(l.in_tokens),0) AS in_tok, COALESCE(SUM(l.out_tokens),0) AS out_tok
             FROM users u LEFT JOIN usage_log l ON l.user_id=u.id GROUP BY u.id ORDER BY in_tok DESC`).all()).results;
          const byDay = (await db.prepare(
            `SELECT date(created_at) AS d, COUNT(*) AS calls, SUM(in_tokens) AS in_tok, SUM(out_tokens) AS out_tok
             FROM usage_log GROUP BY d ORDER BY d DESC LIMIT 14`).all()).results;
          const month = await db.prepare(
            `SELECT COUNT(*) AS calls, COALESCE(SUM(in_tokens),0) AS in_tok, COALESCE(SUM(out_tokens),0) AS out_tok
             FROM usage_log WHERE created_at >= date('now','+9 hours','start of month')`).first();
          return json({ by_user: byUser, by_day: byDay, month, price: { in_per_mtok_usd: 0.75, out_per_mtok_usd: 3.75, model: env.GEMINI_MODEL } }, 200, origin);
        }
        return json({ error: "not found" }, 404, origin);
      }

      // ---------- 작업 대기줄 (사용자) ----------
      if (p === "/jobs" && req.method === "GET") {
        const rows = (await db.prepare("SELECT id, prompt, status, result, error, created_at, finished_at FROM jobs WHERE user_id=? ORDER BY id DESC LIMIT 20").bind(user.id).all()).results;
        return json({ jobs: rows }, 200, origin);
      }

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

  // 매분: 다가오는 일정 알림 + 아침 브리핑. 야간 무음 22~07시, 사용자별 하루 10건 상한, push_enabled 사용자만
  async scheduled(_ev, env) {
    const h = kst().getUTCHours();
    if (h >= QUIET_FROM || h < QUIET_TO) return;
    const now = kstStr();
    await runMorningBrief(env, h, now);
    const users = (await env.DB.prepare("SELECT * FROM users WHERE push_enabled=1").all()).results;
    for (const u of users) {
      const sentToday = (await env.DB.prepare("SELECT COUNT(*) c FROM push_log WHERE user_id=? AND sent_at >= date('now','+9 hours')").bind(u.id).first()).c;
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
        await env.DB.prepare("INSERT INTO push_log (user_id, title, sent_at) VALUES (?,?,datetime('now','+9 hours'))").bind(u.id, payload.title).run();
      }
    }
  },
};
