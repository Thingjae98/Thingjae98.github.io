/* 가족 비서 — 화면 로직 (vanilla) */
(() => {
  const API = window.FA_API;
  const $ = (s) => document.querySelector(s);
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
    del: (k) => { try { localStorage.removeItem(k); } catch {} },
  };
  let token = store.get("fa_token");
  let me = null;
  let attachment = null; // { mimeType, data, preview }
  let deferredInstall = null;

  // ---------- 공통 ----------
  async function api(method, path, body) {
    const r = await fetch(API + path, {
      method,
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token) { logout(false); throw new Error(j.error || "다시 로그인해 주세요"); }
    if (!r.ok) throw new Error(j.error || `오류 (${r.status})`);
    return j;
  }
  const fmt = (n) => (n == null ? "-" : Number(n).toLocaleString("ko-KR"));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  let toastTimer;
  function toast(msg, ms = 3200) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }
  function busy(btn, on) { btn.disabled = on; btn.setAttribute("aria-busy", on ? "true" : "false"); }
  const timeLabel = (iso) => (iso || "").slice(11, 16);
  const dayLabel = (s) => { const [d, t] = s.split(" "); const dt = new Date(d + "T00:00:00"); const w = "일월화수목금토"[dt.getDay()]; return `${d.slice(5).replace("-", "/")} (${w}) ${t}`; };

  // ---------- 잠금 ----------
  let lockMode = "login";
  function showLock() {
    $("#app").hidden = true; $("#lock").hidden = false;
    const h = store.get("fa_handle"); if (h) $("#lock-handle").value = h;
    setLockMode(h ? "login" : "register");
    ($("#lock-handle").value ? $("#lock-pin") : $("#lock-handle")).focus();
  }
  function setLockMode(m) {
    lockMode = m;
    const reg = m === "register";
    $("#lock-sub").textContent = reg ? "받은 초대 코드를 넣고, 앞으로 쓸 비밀번호 4자리를 정해주세요." : "초대 코드와 비밀번호 4자리를 넣어주세요.";
    $("#lock-pin-label").textContent = reg ? "새 비밀번호 4자리" : "비밀번호 4자리";
    $("#lock-submit").textContent = reg ? "비밀번호 만들고 시작" : "들어가기";
    $("#lock-mode").textContent = reg ? "이미 비밀번호가 있어요" : "처음이에요 (비밀번호 만들기)";
    $("#lock-error").hidden = true;
  }
  $("#lock-mode").addEventListener("click", () => setLockMode(lockMode === "login" ? "register" : "login"));
  $("#lock-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const handle = $("#lock-handle").value.trim().toUpperCase(), pin = $("#lock-pin").value;
    const err = $("#lock-error"); err.hidden = true;
    if (!/^\d{4}$/.test(pin)) { err.textContent = "비밀번호는 숫자 4자리입니다."; err.hidden = false; return; }
    busy($("#lock-submit"), true);
    try {
      const r = await api("POST", lockMode === "register" ? "/auth/register" : "/auth/login", { handle, pin });
      token = r.token; store.set("fa_token", token); store.set("fa_handle", handle);
      $("#lock-pin").value = "";
      await enter();
    } catch (ex) { err.textContent = ex.message; err.hidden = false; $("#lock-pin").select(); }
    finally { busy($("#lock-submit"), false); }
  });
  function logout(callServer = true) {
    if (callServer && token) api("POST", "/auth/logout").catch(() => {});
    token = null; store.del("fa_token"); me = null; showLock();
  }

  // ---------- 탐색 ----------
  const VIEWS = [
    { id: "chat", label: "대화", icon: '<path d="M4 5h16v11H9l-5 4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>' },
    { id: "assets", label: "자산", icon: '<path d="M4 18l5-6 4 3 7-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 21h18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
    { id: "events", label: "일정", icon: '<rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
    { id: "settings", label: "설정", icon: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  ];
  function buildNav() {
    const html = VIEWS.map((v) => `<button class="tab" type="button" data-go="${v.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg><span>${v.label}</span></button>`).join("");
    $("#nav-side").innerHTML = html; $("#nav-bottom").innerHTML = html;
    document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  }
  const loaders = { chat: loadChat, assets: loadAssets, events: loadEvents, settings: loadSettings };
  function go(id, push = true) {
    document.querySelectorAll(".view").forEach((v) => { v.hidden = v.dataset.view !== id; });
    document.querySelectorAll("[data-go]").forEach((b) => { if (b.dataset.go === id) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("#top-title").textContent = VIEWS.find((v) => v.id === id).label;
    if (push) history.replaceState(null, "", "#" + id);
    loaders[id]().catch((e) => toast(e.message));
    if (id !== "chat") window.scrollTo({ top: 0 });
  }

  async function enter() {
    me = await api("GET", "/me");
    $("#lock").hidden = true; $("#app").hidden = false;
    applyMe();
    const h = location.hash.slice(1);
    go(VIEWS.some((v) => v.id === h) ? h : "chat", false);
    registerSW();
  }
  function applyMe() {
    $("#side-agent").textContent = me.agent_name;
    $("#side-user").textContent = `${me.name}${me.honorific}`;
    document.title = me.agent_name;
  }

  // ---------- 대화 ----------
  let chatLoaded = false;
  function renderMd(text) {
    const safe = esc(text);
    try { return marked.parse(safe, { breaks: true, gfm: true }); } catch { return `<p>${safe.replace(/\n/g, "<br>")}</p>`; }
  }
  function addMsg(role, content, opts = {}) {
    const log = $("#chat-log");
    log.querySelector(".empty")?.remove();
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : "bot"}${opts.pending ? " pending" : ""}`;
    const thumb = opts.thumb ? `<img class="thumb" src="${opts.thumb}" alt="첨부한 캡처">` : "";
    const body = opts.pending ? `<span class="dots">${esc(content)}</span>` : role === "user" ? `<p>${esc(content).replace(/\n/g, "<br>")}</p>` : renderMd(content);
    el.innerHTML = `${thumb}<div class="bubble">${body}</div>${opts.time ? `<div class="time">${opts.time}</div>` : ""}`;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
    return el;
  }
  async function loadChat() {
    if (chatLoaded) return;
    const { messages } = await api("GET", "/messages");
    const log = $("#chat-log"); log.innerHTML = "";
    if (!messages.length) {
      log.innerHTML = `<div class="empty"><strong>${esc(me.name)}${esc(me.honorific)}, 안녕하세요.</strong>종목 이름을 말씀하시면 현재가와 퇴직연금 계좌로 살 수 있는지 바로 알려드립니다. 아래 버튼을 눌러 시작해도 됩니다.</div>`;
    }
    for (const m of messages) addMsg(m.role, m.content, { time: timeLabel(m.created_at) });
    chatLoaded = true;
  }
  const input = $("#chat-input");
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing && window.matchMedia("(min-width: 1024px)").matches) { e.preventDefault(); $("#chat-form").requestSubmit(); } });
  $("#chips").addEventListener("click", (e) => { const b = e.target.closest(".chip"); if (!b) return; input.value = b.dataset.q; $("#chat-form").requestSubmit(); });
  $("#attach").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { attachment = await shrinkImage(f); $("#attach-img").src = attachment.preview; $("#attach-preview").hidden = false; }
    catch { toast("사진을 읽지 못했습니다."); }
    e.target.value = "";
  });
  $("#attach-remove").addEventListener("click", () => { attachment = null; $("#attach-preview").hidden = true; });
  $("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text && !attachment) return;
    const img = attachment; attachment = null; $("#attach-preview").hidden = true;
    input.value = ""; input.style.height = "auto";
    addMsg("user", text || "(사진)", { thumb: img?.preview, time: new Date().toTimeString().slice(0, 5) });
    const pending = addMsg("model", `${me.agent_name}가 생각 중`, { pending: true });
    busy($("#chat-send"), true);
    try {
      const r = await api("POST", "/chat", { text, image: img ? { mimeType: img.mimeType, data: img.data } : undefined });
      pending.remove();
      addMsg("model", r.reply, { time: new Date().toTimeString().slice(0, 5) });
    } catch (ex) {
      pending.remove();
      addMsg("model", `죄송합니다, 답을 가져오지 못했습니다. (${ex.message}) 잠시 후 다시 말씀해 주세요.`);
    } finally { busy($("#chat-send"), false); input.focus(); }
  });
  function shrinkImage(file) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const max = 1400, s = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas"); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        const url = c.toDataURL("image/jpeg", 0.85);
        res({ mimeType: "image/jpeg", data: url.split(",")[1], preview: url });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = rej; img.src = URL.createObjectURL(file);
    });
  }

  // ---------- 자산 ----------
  const badge = (p) => {
    if (!p) return "";
    const cls = p.verdict === "가능" ? "ok" : p.verdict === "불가" ? "no" : "warn";
    const label = p.verdict === "가능" ? (p.group === "100" ? "퇴직연금 100%" : "퇴직연금 70%") : p.verdict;
    return `<span class="badge ${cls}">${label}</span>`;
  };
  async function loadAssets() {
    const d = await api("GET", "/holdings");
    $("#balance-input").value = d.total_balance ? fmt(d.total_balance) : "";
    const fill = $("#risk-fill");
    if (d.risk_ratio_pct == null) { fill.style.width = "0"; $("#risk-text").textContent = d.holdings.length ? "전체 적립금을 입력하면 비중을 계산합니다." : "보유 종목과 전체 적립금을 넣으면 비중이 보입니다."; }
    else {
      const pct = Math.min(100, d.risk_ratio_pct);
      fill.style.width = pct + "%"; fill.className = "meter-fill" + (pct > 70 ? " over" : pct > 62 ? " near" : "");
      $("#risk-text").textContent = `위험자산 ${fmt(d.risk_value)}원 · 적립금의 ${d.risk_ratio_pct}%` + (pct > 70 ? " (한도 초과, 위험자산 추가 매수는 거절됩니다)" : pct > 62 ? " (한도에 가까움)" : "");
    }
    $("#risk-meter").setAttribute("aria-label", `위험자산 비중 ${d.risk_ratio_pct ?? 0}퍼센트, 한도 70퍼센트`);
    const hl = $("#holdings-list");
    hl.innerHTML = d.holdings.length ? d.holdings.map((h) => {
      const pl = h.avg_price && h.price ? ((h.price - h.avg_price) / h.avg_price) * 100 : null;
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(h.name)}</div><div class="item-sub">${fmt(h.qty)}주${h.avg_price ? ` · 평단 ${fmt(h.avg_price)}원` : ""}</div></div>
        <div class="item-num"><div>${fmt(h.value)}원</div>${pl != null ? `<div class="item-sub ${pl >= 0 ? "up" : "down"}">${pl >= 0 ? "+" : ""}${pl.toFixed(1)}%</div>` : ""}</div>
        <button class="del" type="button" data-del-holding="${h.id}" aria-label="${esc(h.name)} 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`;
    }).join("") : `<div class="empty-row">아직 등록된 종목이 없습니다.</div>`;
    $("#holdings-updated").textContent = d.holdings.length ? "현재가 기준" : "";
    const { trades } = await api("GET", "/trades");
    $("#trades-list").innerHTML = trades.length ? trades.map((t) => `<div class="item"><div class="item-main"><div class="item-title">${t.side === "buy" ? "매수" : "매도"} · ${esc(t.name)}</div><div class="item-sub">${t.trade_date} · ${fmt(t.qty)}주 × ${fmt(t.price)}원${t.reason ? ` · ${esc(t.reason)}` : ""}${t.target_price ? ` · 목표 ${fmt(t.target_price)}` : ""}${t.stop_price ? ` · 손절 ${fmt(t.stop_price)}` : ""}</div></div>
      <button class="del" type="button" data-del-trade="${t.id}" aria-label="기록 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`).join("")
      : `<div class="empty-row">매수·매도하신 것을 대화로 말씀하시면 여기 기록됩니다.</div>`;
  }
  $("#balance-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = Number($("#balance-input").value.replace(/[^\d]/g, ""));
    if (!n) return toast("금액을 숫자로 넣어주세요.");
    await api("PATCH", "/me", { total_balance: n }); toast("적립금을 저장했습니다."); loadAssets();
  });
  $("#balance-input").addEventListener("input", (e) => { const n = e.target.value.replace(/[^\d]/g, ""); e.target.value = n ? Number(n).toLocaleString("ko-KR") : ""; });
  document.addEventListener("click", async (e) => {
    const h = e.target.closest("[data-del-holding]"), t = e.target.closest("[data-del-trade]"), ev = e.target.closest("[data-del-event]"), m = e.target.closest("[data-del-memory]");
    try {
      if (h && confirm("이 종목을 목록에서 지울까요?")) { await api("DELETE", "/holdings/" + h.dataset.delHolding); loadAssets(); }
      if (t && confirm("이 매매 기록을 지울까요?")) { await api("DELETE", "/trades/" + t.dataset.delTrade); loadAssets(); }
      if (ev && confirm("이 일정을 지울까요? 반복 일정이면 전부 지워집니다.")) { await api("DELETE", "/events/" + ev.dataset.delEvent); loadEvents(); }
      if (m) { await api("DELETE", "/memories/" + m.dataset.delMemory); loadSettings(); }
    } catch (ex) { toast(ex.message); }
  });

  // ---------- 일정 ----------
  async function loadEvents() {
    const { upcoming } = await api("GET", "/events");
    $("#events-list").innerHTML = upcoming.length ? upcoming.map((e) => `<div class="item"><div class="item-main"><div class="item-title">${esc(e.title)}</div><div class="item-sub">${dayLabel(e.at)}${e.repeat !== "none" ? ` · ${e.repeat === "weekly" ? "매주" : "매일"}` : ""} · ${e.remind_min ? e.remind_min + "분 전 알림" : "정각 알림"}</div></div>
      <button class="del" type="button" data-del-event="${e.id}" aria-label="${esc(e.title)} 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`).join("")
      : `<div class="empty-row">앞으로 30일 안에 잡힌 일정이 없습니다. 아래에서 추가하거나 대화로 "토요일 3시 탁구"처럼 말씀하세요.</div>`;
    if (!$("#ev-date").value) $("#ev-date").value = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  $("#event-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.submitter || e.target.querySelector("button[type=submit]"); busy(btn, true);
    try {
      await api("POST", "/events", { title: $("#ev-title").value.trim(), start_at: `${$("#ev-date").value} ${$("#ev-time").value}`, repeat: $("#ev-repeat").value, remind_min: Number($("#ev-remind").value) });
      $("#ev-title").value = ""; toast("일정을 저장했습니다."); loadEvents();
    } catch (ex) { toast(ex.message); } finally { busy(btn, false); }
  });

  // ---------- 설정 ----------
  async function loadSettings() {
    $("#s-agent").value = me.agent_name; $("#s-name").value = me.name; $("#s-honorific").value = me.honorific;
    const preset = $("#s-tone-preset"); const found = [...preset.options].find((o) => o.value === me.tone);
    preset.value = found ? me.tone : "custom"; $("#s-tone").value = me.tone; $("#s-tone-custom-wrap").hidden = preset.value !== "custom";
    $("#s-handle").textContent = me.handle; $("#s-api").textContent = API.replace(/^https?:\/\//, "");
    $("#push-toggle").setAttribute("aria-checked", me.push_enabled ? "true" : "false");
    $("#push-status").textContent = !("PushManager" in window) ? "이 브라우저는 알림을 지원하지 않습니다. 홈 화면에 추가한 뒤 열어보세요." : Notification.permission === "denied" ? "브라우저에서 알림이 차단되어 있습니다. 설정에서 허용해 주세요." : "";
    $("#install-btn").hidden = !deferredInstall;
    const { memories } = await api("GET", "/memories");
    $("#memories-list").innerHTML = memories.length ? memories.map((m) => `<div class="item"><div class="item-main"><div>${esc(m.content)}</div><div class="item-sub">${m.created_at.slice(0, 10)}</div></div><button class="del" type="button" data-del-memory="${m.id}" aria-label="기억 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`).join("")
      : `<div class="empty-row">아직 기억해 둔 것이 없습니다.</div>`;
  }
  $("#s-tone-preset").addEventListener("change", (e) => { $("#s-tone-custom-wrap").hidden = e.target.value !== "custom"; if (e.target.value !== "custom") $("#s-tone").value = e.target.value; });
  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || e.target.querySelector("button[type=submit]"); busy(btn, true);
    try {
      const tone = $("#s-tone-preset").value === "custom" ? $("#s-tone").value.trim() : $("#s-tone-preset").value;
      me = await api("PATCH", "/me", { agent_name: $("#s-agent").value.trim(), name: $("#s-name").value.trim(), honorific: $("#s-honorific").value, tone: tone || me.tone });
      applyMe(); chatLoaded = false; toast("저장했습니다.");
    } catch (ex) { toast(ex.message); } finally { busy(btn, false); }
  });
  $("#push-toggle").addEventListener("click", async () => {
    const on = $("#push-toggle").getAttribute("aria-checked") !== "true";
    try {
      if (on) {
        if (!("PushManager" in window)) throw new Error("이 브라우저는 알림을 지원하지 않습니다.");
        const perm = await Notification.requestPermission();
        if (perm !== "granted") throw new Error("알림 권한이 허용되지 않았습니다.");
        const reg = await navigator.serviceWorker.ready;
        const { key } = await api("GET", "/push/vapid");
        const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToU8(key) });
        await api("POST", "/push/subscribe", sub.toJSON());
        me = await api("PATCH", "/me", { push_enabled: true });
        toast("알림을 켰습니다. '알림 테스트'로 확인해 보세요.");
      } else {
        const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe();
        await api("DELETE", "/push/subscribe"); me = await api("PATCH", "/me", { push_enabled: false });
        toast("알림을 껐습니다.");
      }
    } catch (ex) { toast(ex.message); }
    loadSettings();
  });
  $("#push-test").addEventListener("click", async (e) => {
    busy(e.currentTarget, true);
    try { const r = await api("POST", "/push/test"); toast(r.sent.length ? "테스트 알림을 보냈습니다." : "먼저 알림을 켜주세요."); } catch (ex) { toast(ex.message); } finally { busy(e.currentTarget, false); }
  });
  $("#clear-chat").addEventListener("click", async () => { if (!confirm("대화 기록을 모두 지울까요? 보유 종목·일정·기억은 남습니다.")) return; await api("DELETE", "/messages"); chatLoaded = false; toast("대화 기록을 지웠습니다."); });
  $("#logout").addEventListener("click", () => { if (confirm("이 기기에서 로그아웃할까요? 다시 들어올 때 코드와 비밀번호가 필요합니다.")) logout(); });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("#install-btn").hidden = false; });
  $("#install-btn").addEventListener("click", async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#install-btn").hidden = true; });
  function urlB64ToU8(s) { const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  function registerSW() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {}); }

  // ---------- 시작 ----------
  buildNav();
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (me && VIEWS.some((v) => v.id === h)) go(h, false); });
  if (token) enter().catch(() => showLock()); else showLock();
})();
