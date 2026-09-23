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
    let r;
    try {
      r = await fetch(API + path, {
        method,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new Error("인터넷 연결을 확인해 주세요."); }
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && token) { logout(false); throw new Error(j.error || "다시 로그인해 주세요"); }
    if (r.status >= 500) throw new Error("잠시 문제가 생겼습니다. 조금 뒤 다시 해 주세요.");
    if (!r.ok) throw new Error(j.error || `요청을 처리하지 못했습니다. (${r.status})`);
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
    $("#lock-form").hidden = false; $("#lock-mode").hidden = false;
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
    { id: "admin", label: "관리", adminOnly: true, icon: '<path d="M12 3l7 3v5.5c0 4.2-2.9 7.6-7 8.5-4.1-.9-7-4.3-7-8.5V6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>' },
    { id: "settings", label: "설정", icon: '<circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' },
  ];
  function visibleViews() { return VIEWS.filter((v) => !v.adminOnly || me?.is_admin); }
  function buildNav() {
    const html = visibleViews().map((v) => `<button class="tab" type="button" data-go="${v.id}"><svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg><span>${v.label}</span></button>`).join("");
    document.querySelector(".tabbar").style.gridTemplateColumns = `repeat(${visibleViews().length}, 1fr)`;
    $("#nav-side").innerHTML = html; $("#nav-bottom").innerHTML = html;
    document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  }
  const loaders = { chat: loadChat, assets: loadAssets, events: loadEvents, settings: loadSettings, admin: loadAdmin };
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
    buildNav();
    applyMe();
    const h = location.hash.slice(1);
    go(VIEWS.some((v) => v.id === h) ? h : "chat", false);
    registerSW();
  }
  const CHIPS = {
    pension: [
      ["오늘의 점검", "오늘 내 포트폴리오 이슈 체크해줘"],
      ["보유 현황", "내 보유 ETF 지금 어때?"],
      ["안전자산 확인", "내 위험자산 비중이 70% 한도 안에 있는지 확인해줘"],
      ["ETF 찾기", "퇴직연금으로 살 수 있는 채권혼합형 ETF 찾아줘"],
      ["입금 배분", "이번에 100만 원을 입금할 예정인데, 위험자산 70% 한도 안에서 보유 ETF와 안전자산 중 어디에 얼마씩 나누면 좋을지 참고 의견 줘"],
      ["오늘 일정", "오늘 일정 알려줘"],
    ],
    general: [
      ["오늘의 점검", "오늘 내 종목 이슈 체크해줘"],
      ["보유 현황", "내 보유 종목 지금 어때?"],
      ["증시 뉴스", "오늘 국내외 증시 뉴스 세 줄로 요약해줘"],
      ["종목 분석", "관심 있는 종목이 있는데 재무랑 뉴스 정리해줄래?"],
      ["오늘 일정", "오늘 일정 알려줘"],
    ],
  };
  function applyChips() {
    const list = CHIPS[me.account_type] || CHIPS.pension;
    $("#chips").innerHTML = list.map(([label, q]) => `<button class="chip" type="button" data-q="${esc(q)}">${esc(label)}</button>`).join("");
  }
  function applyMe() {
    applyChips();
    $("#side-agent").textContent = me.agent_name;
    $("#side-user").textContent = `${me.name}${me.honorific}`;
    document.title = me.agent_name;
  }

  // ---------- 대화 ----------
  let chatLoaded = false;
  function renderMd(text) {
    const safe = esc(text);
    let html;
    try { html = marked.parse(safe, { breaks: true, gfm: true }); } catch { return `<p>${safe.replace(/\n/g, "<br>")}</p>`; }
    // 보안: 답에 섞인 javascript: 같은 링크로 로그인 정보가 빠져나가지 않게 http(s) 링크만 남긴다. 외부 이미지는 글자로 바꾼다
    const t = document.createElement("template");
    t.innerHTML = html;
    t.content.querySelectorAll("a").forEach((a) => {
      if (/^https?:\/\//i.test(a.getAttribute("href") || "")) { a.target = "_blank"; a.rel = "noopener noreferrer"; }
      else a.replaceWith(document.createTextNode(a.textContent));
    });
    t.content.querySelectorAll("img").forEach((img) => img.replaceWith(document.createTextNode(img.alt || "")));
    return t.innerHTML;
  }
  function addMsg(role, content, opts = {}) {
    const log = $("#chat-log");
    log.querySelector(".empty")?.remove();
    const el = document.createElement("div");
    el.className = `msg ${role === "user" ? "user" : "bot"}${opts.pending ? " pending" : ""}`;
    const thumb = opts.thumb ? `<img class="thumb" src="${opts.thumb}" alt="첨부한 캡처">` : "";
    const body = opts.pending ? `<span class="dots">${esc(content)}</span>` : role === "user" ? `<p>${esc(content).replace(/\n/g, "<br>")}</p>` : renderMd(content);
    el.innerHTML = `${thumb}<div class="bubble">${body}</div>${opts.time ? `<div class="time">${opts.time}</div>` : ""}`;
    if (opts.document) {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn secondary doc-open";
      btn.textContent = (opts.document.format === "pptx" ? "발표자료 보기" : "문서 보기") + " · " + opts.document.title;
      btn.addEventListener("click", () => openDoc(opts.document));
      el.appendChild(btn);
    }
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
    for (const m of messages) {
      if (m.content === "깊이 알아보고 있습니다. 준비되면 알려드리겠습니다.") continue; // 깊게 대기 안내는 진행 말풍선이 대신한다
      let doc = null;
      if (m.document) { try { doc = JSON.parse(m.document); } catch {} }
      addMsg(m.role, m.content, { time: timeLabel(m.created_at), document: doc });
    }
    chatLoaded = true;
    resumePendingJobs();
  }
  const MODE_HINT = {
    fast: "Gemini Flash Lite",
    smart: "Gemini Flash",
    deep: "Claude Opus",
  };
  let chatMode = store.get("fa_mode") || "smart";
  function applyMode() {
    document.querySelectorAll(".mode").forEach((b) => b.setAttribute("aria-checked", b.dataset.mode === chatMode ? "true" : "false"));
    $("#mode-hint").textContent = MODE_HINT[chatMode];
  }
  document.querySelectorAll(".mode").forEach((b) => b.addEventListener("click", () => {
    chatMode = b.dataset.mode; store.set("fa_mode", chatMode); applyMode();
  }));
  applyMode();

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
    // 깊게(집 PC)는 사진을 받을 수 없으니 사진이 있으면 기본으로 읽는다
    const mode = chatMode === "deep" && img ? "smart" : chatMode;
    if (mode !== chatMode) toast("사진은 '기본'으로 읽어 드립니다.");
    const pending = addMsg("model", mode === "deep" ? "깊이 알아보는 중" : `${me.agent_name}가 생각 중`, { pending: true });
    busy($("#chat-send"), true);
    try {
      const r = await api("POST", "/chat", { text, mode, image: img ? { mimeType: img.mimeType, data: img.data } : undefined });
      pending.remove();
      // 깊게로 넘긴 경우 "알아보고 있습니다" 안내는 진행 표시 말풍선 하나로만 보여준다
      if (!(r.job_id && mode === "deep")) addMsg("model", r.reply, { time: new Date().toTimeString().slice(0, 5), document: r.document });
      if (r.job_id) watchJob(r.job_id);
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
    const general = me.account_type === "general";
    const tradesReq = api("GET", "/trades"); // 보유 종목과 동시에 부른다
    const d = await api("GET", "/holdings");
    // 계좌 종류에 따라 자산 화면의 머리말을 바꾼다
    $("#risk-panel-title").textContent = general ? "자산 구성" : "위험자산 비중";
    $("#risk-limit-label").textContent = general ? "" : "한도 70%";
    $("#balance-label").textContent = general ? "계좌 총평가금액 (원)" : "퇴직연금 전체 적립금 (원)";
    $("#risk-meter").hidden = general;
    $("#balance-input").value = d.total_balance ? fmt(d.total_balance) : "";

    const totalValue = d.holdings.reduce((s2, h) => s2 + (h.value || 0), 0);
    if (general) {
      $("#risk-text").textContent = totalValue ? `보유 종목 평가금액 합계 ${fmt(totalValue)}원` : "보유 종목을 넣으면 합계가 보입니다.";
    } else {
      const fill = $("#risk-fill");
      if (d.risk_ratio_pct == null) { fill.style.width = "0"; $("#risk-text").textContent = d.holdings.length ? "전체 적립금을 입력하면 비중을 계산합니다." : "보유 종목과 전체 적립금을 넣으면 비중이 보입니다."; }
      else {
        const pct = Math.min(100, d.risk_ratio_pct);
        fill.style.width = pct + "%"; fill.className = "meter-fill" + (pct > 70 ? " over" : pct > 62 ? " near" : "");
        const safe = Math.max(0, 100 - d.risk_ratio_pct).toFixed(1);
        $("#risk-text").textContent = `위험자산 ${fmt(d.risk_value)}원 · 적립금의 ${d.risk_ratio_pct}% (안전자산 ${safe}%)` + (pct > 70 ? " — 한도 초과, 위험자산 추가 매수는 거절됩니다" : pct > 62 ? " — 한도에 가까움" : "");
      }
      $("#risk-meter").setAttribute("aria-label", `위험자산 비중 ${d.risk_ratio_pct ?? 0}퍼센트, 한도 70퍼센트`);
    }
    // 비중(%)으로 등록한 종목이 있을 때만: 등록 ETF가 계좌에서 차지하는 비율
    $("#share-wrap").hidden = general || !d.holdings.some((h) => h.weight_pct != null);
    setShare(d.etf_share_pct ?? 100);

    const hl = $("#holdings-list");
    hl.innerHTML = d.holdings.length ? d.holdings.map((h) => {
      const pl = h.avg_price && h.price ? ((h.price - h.avg_price) / h.avg_price) * 100 : null;
      const share = h.weight_pct != null ? h.weight_pct + "%" : (totalValue && h.value ? ((h.value / totalValue) * 100).toFixed(1) + "%" : null);
      const detail = [h.qty ? `${fmt(h.qty)}주` : null, h.avg_price ? `평단 ${fmt(h.avg_price)}원` : null, share ? `비중 ${share}` : null, h.fee_pct != null ? `총보수 ${h.fee_pct}%` : null].filter(Boolean).join(" · ") || "수량 미입력";
      return `<div class="item"><div class="item-main"><div class="item-title">${esc(h.name)}</div><div class="item-sub">${detail}</div></div>
        <div class="item-num">${h.value != null ? `<div>${fmt(h.value)}원</div>` : (h.price ? `<div class="item-sub">${fmt(h.price)}원</div>` : "")}${pl != null ? `<div class="item-sub ${pl >= 0 ? "up" : "down"}">${pl >= 0 ? "+" : ""}${pl.toFixed(1)}%</div>` : ""}</div>
        <button class="del" type="button" data-del-holding="${h.id}" aria-label="${esc(h.name)} 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`;
    }).join("") : `<div class="empty-row">아직 등록된 종목이 없습니다.</div>`;
    $("#holdings-updated").textContent = d.holdings.length ? "현재가 기준" : "";

    const { trades } = await tradesReq;
    $("#trades-list").innerHTML = trades.length ? trades.map((t) => `<div class="item"><div class="item-main"><div class="item-title">${t.side === "buy" ? "매수" : "매도"} · ${esc(t.name)}</div><div class="item-sub">${t.trade_date} · ${fmt(t.qty)}주 × ${fmt(t.price)}원${t.reason ? ` · ${esc(t.reason)}` : ""}${t.target_price ? ` · 목표 ${fmt(t.target_price)}` : ""}${t.stop_price ? ` · 손절 ${fmt(t.stop_price)}` : ""}</div></div>
      <button class="del" type="button" data-del-trade="${t.id}" aria-label="기록 삭제"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>`).join("")
      : `<div class="empty-row">매수·매도하신 것을 대화로 말씀하시면 여기 기록됩니다.</div>`;
  }

  function setShare(v) {
    $("#share-input").value = v;
    $("#share-val").textContent = `${v}%`;
    $("#share-input").setAttribute("aria-valuetext", `ETF ${v}퍼센트, 안전자산 ${100 - v}퍼센트`);
  }
  $("#share-input").addEventListener("input", (e) => setShare(Number(e.target.value)));
  $("#share-input").addEventListener("change", async (e) => {
    try {
      await api("PATCH", "/me", { etf_share_pct: Number(e.target.value) });
      toast(`ETF ${e.target.value}%, 안전자산 ${100 - Number(e.target.value)}%로 계산합니다.`);
      loadAssets();
    } catch (ex) { toast(ex.message); }
  });

  $("#holdings-image").addEventListener("change", async (e) => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    let img;
    try { img = await shrinkImage(f); } catch { return toast("사진을 읽지 못했습니다."); }
    toast("사진을 읽고 있습니다. 잠시만 기다려 주세요.", 30000);
    e.target.disabled = true; // 읽는 동안 두 번 올리지 않게
    try {
      const r = await api("POST", "/chat", {
        text: "이 사진은 제 보유 종목 목록입니다. 종목명과 수량 또는 비중(%)을 읽어서 set_holding 으로 전부 등록해 주세요. 수량이 없고 비중만 적혀 있으면 weight_pct 에 그 값을 넣으세요. 등록한 내용을 한 줄로만 알려주세요.",
        image: { mimeType: img.mimeType, data: img.data },
        keep_log: false,
      });
      toast(r.reply ? r.reply.replace(/[#*|]/g, "").slice(0, 90) : "등록했습니다.", 12000);
      loadAssets();
    } catch (ex) { toast(ex.message); } finally { e.target.disabled = false; }
  });
  $("#balance-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const n = Number($("#balance-input").value.replace(/[^\d]/g, ""));
    if (!n) return toast("금액을 숫자로 넣어주세요.");
    try { await api("PATCH", "/me", { total_balance: n }); toast("적립금을 저장했습니다."); loadAssets(); } catch (ex) { toast(ex.message); }
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
    const { upcoming, market = [] } = await api("GET", "/events");
    // 시장 일정: 연준·한은·미국 노동통계국 공식 일정 (읽기 전용, 알림 없음)
    $("#market-list").innerHTML = market.length ? market.map((m) => `<div class="item"><div class="item-main"><div class="item-title">${esc(m.title)}</div><div class="item-sub">${dayLabel(m.date + " " + (m.time || "")).trim()}${m.time ? "" : " · 시각 미정"} · <a href="${esc(m.source)}" target="_blank" rel="noopener noreferrer">출처</a></div></div></div>`).join("")
      : `<div class="empty-row">앞으로 60일 안에 잡힌 시장 일정이 없습니다.</div>`;
    $("#events-list").innerHTML = upcoming.length ? upcoming.map((e) => `<div class="item"><div class="item-main"><div class="item-title">${esc(e.title)}</div><div class="item-sub">${dayLabel(e.at)}${e.repeat !== "none" ? ` · ${e.repeat === "weekly" ? "매주" : "매일"}` : ""} · ${!e.remind_min ? "정각 알림" : e.remind_min % 1440 === 0 ? e.remind_min / 1440 + "일 전 알림" : e.remind_min % 60 === 0 ? e.remind_min / 60 + "시간 전 알림" : e.remind_min + "분 전 알림"}</div></div>
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
    $("#brief-toggle").setAttribute("aria-checked", me.brief_enabled ? "true" : "false");
    $("#brief-hour").value = String(me.brief_hour ?? 8);
    $("#brief-hour-wrap").hidden = !me.brief_enabled;
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
  $("#brief-toggle").addEventListener("click", async () => {
    const on = $("#brief-toggle").getAttribute("aria-checked") !== "true";
    try {
      me = await api("PATCH", "/me", { brief_enabled: on });
      toast(on ? (me.push_enabled ? `매일 아침 ${$("#brief-hour").value}시에 보내드립니다.` : `매일 아침 ${$("#brief-hour").value}시에 대화창에 올려둡니다. 휴대폰 알림도 받으시려면 위의 일정 알림을 켜주세요.`) : "아침 브리핑을 껐습니다.", 6000);
    } catch (ex) { toast(ex.message); }
    loadSettings();
  });
  $("#brief-hour").addEventListener("change", async (e) => {
    try { me = await api("PATCH", "/me", { brief_hour: Number(e.target.value) }); toast(`아침 ${e.target.value}시로 바꿨습니다.`); } catch (ex) { toast(ex.message); }
  });
  $("#push-test").addEventListener("click", async (e) => {
    busy(e.currentTarget, true);
    try { const r = await api("POST", "/push/test"); toast(r.sent.length ? "테스트 알림을 보냈습니다." : "먼저 알림을 켜주세요."); } catch (ex) { toast(ex.message); } finally { busy(e.currentTarget, false); }
  });
  $("#clear-chat").addEventListener("click", async () => { if (!confirm("대화 기록을 모두 지울까요? 보유 종목·일정·기억은 남습니다.")) return; try { await api("DELETE", "/messages"); chatLoaded = false; toast("대화 기록을 지웠습니다."); } catch (ex) { toast(ex.message); } });
  $("#logout").addEventListener("click", () => { if (confirm("이 기기에서 로그아웃할까요? 다시 들어올 때 코드와 비밀번호가 필요합니다.")) logout(); });
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredInstall = e; $("#install-btn").hidden = false; });
  $("#install-btn").addEventListener("click", async () => { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("#install-btn").hidden = true; });
  function urlB64ToU8(s) { const b = atob((s + "=".repeat((4 - (s.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, (c) => c.charCodeAt(0)); }
  // 앱을 다시 열면(백그라운드→화면) 그사이 도착한 브리핑·답이 보이게 대화를 다시 불러온다
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !me || $("#view-chat").hidden) return;
    watching.clear(); chatLoaded = false; loadChat().catch(() => {});
  });
  function registerSW() { if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {}); }

  // ---------- 관리 ----------
  const ACCOUNT_LABEL = { pension: "퇴직연금 전용", general: "일반 계좌" };
  async function loadAdmin() {
    const { users } = await api("GET", "/admin/users");
    $("#admin-count").textContent = `${users.length}명`;
    $("#admin-users").innerHTML = users.map((u) => `
      <div class="item admin-item">
        <div class="item-main">
          <div class="item-title">${esc(u.name)} <span class="mono muted">${u.handle}</span>${u.is_admin ? ' <span class="badge ok">관리자</span>' : ""}</div>
          <div class="item-sub">${u.registered ? `가입함 · 대화 ${u.msg_count}회${u.last_seen ? " · 최근 " + u.last_seen.slice(5, 16) : ""}` : "아직 가입 전"}</div>
          <div class="admin-actions">
            <select data-acct="${u.id}" aria-label="${esc(u.name)} 계좌 종류">
              <option value="pension"${u.account_type === "pension" ? " selected" : ""}>퇴직연금 전용</option>
              <option value="general"${u.account_type === "general" ? " selected" : ""}>일반 계좌</option>
            </select>
            <button class="btn ghost small" type="button" data-reset="${u.id}" data-name="${esc(u.name)}">비밀번호 초기화</button>
            ${u.is_admin ? "" : `<button class="btn ghost small danger" type="button" data-deluser="${u.id}" data-name="${esc(u.name)}">삭제</button>`}
          </div>
        </div>
      </div>`).join("");

    const d = await api("GET", "/admin/usage");
    const won = (t) => Math.round(((t.in_tok / 1e6) * d.price.in_per_mtok_usd + (t.out_tok / 1e6) * d.price.out_per_mtok_usd) * 1400);
    $("#usage-cost").textContent = `약 ${fmt(won(d.month))}원 · 대화 ${fmt(d.month.calls)}회`;
    const rows = d.by_user.filter((u) => u.calls > 0);
    $("#usage-body").innerHTML = rows.length
      ? `<div class="list">${rows.map((u) => `<div class="item"><div class="item-main"><div class="item-title">${esc(u.name)}</div><div class="item-sub">대화 ${fmt(u.calls)}회</div></div><div class="item-num">약 ${fmt(won(u))}원</div></div>`).join("")}</div>
         <p class="hint">누적 기준입니다. 요금은 ${d.price.model} 기준으로 환산했고 실제 청구액은 구글 콘솔에서 확인하세요.</p>`
      : `<p class="empty-row">아직 사용 기록이 없습니다.</p>`;
  }
  $("#invite-form").addEventListener("submit", async (e) => {
    e.preventDefault(); const btn = e.submitter || e.target.querySelector("button[type=submit]"); busy(btn, true);
    try {
      const r = await api("POST", "/admin/users", { name: $("#inv-name").value.trim(), account_type: $("#inv-type").value });
      $("#invite-code").textContent = r.handle;
      $("#invite-result").hidden = false;
      $("#inv-name").value = "";
      loadAdmin();
    } catch (ex) { toast(ex.message); } finally { busy(btn, false); }
  });
  $("#invite-copy").addEventListener("click", async () => {
    const text = `${location.origin}${location.pathname}\n초대 코드: ${$("#invite-code").textContent}\n\n주소를 열고 코드를 넣은 뒤 원하는 비밀번호 4자리를 정하세요.`;
    try { await navigator.clipboard.writeText(text); toast("복사했습니다."); } catch { toast("복사가 안 됩니다. 코드를 직접 적어주세요."); }
  });
  document.addEventListener("change", async (e) => {
    const sel = e.target.closest("[data-acct]"); if (!sel) return;
    try { await api("PATCH", "/admin/users/" + sel.dataset.acct, { account_type: sel.value }); toast(`${ACCOUNT_LABEL[sel.value]}으로 바꿨습니다.`); } catch (ex) { toast(ex.message); }
  });
  document.addEventListener("click", async (e) => {
    const reset = e.target.closest("[data-reset]"), del = e.target.closest("[data-deluser]");
    try {
      if (reset && confirm(`${reset.dataset.name}님의 비밀번호를 지울까요? 24시간 안에 같은 초대 코드로 들어와 새로 정해야 합니다.`)) {
        await api("PATCH", "/admin/users/" + reset.dataset.reset, { reset_pin: true }); toast("초기화했습니다."); loadAdmin();
      }
      if (del && confirm(`${del.dataset.name}님의 계정과 모든 기록을 지울까요? 되돌릴 수 없습니다.`)) {
        await api("DELETE", "/admin/users/" + del.dataset.deluser); toast("삭제했습니다."); loadAdmin();
      }
    } catch (ex) { toast(ex.message); }
  });

  // ---------- 오래 걸리는 분석 ----------
  const watching = new Set();
  function watchJob(id) {
    if (watching.has(id)) return;
    watching.add(id);
    const el = addMsg("model", "자세히 알아보고 있습니다. 몇 분 걸립니다", { pending: true });
    el.dataset.job = id;
    const started = Date.now();
    const tick = async () => {
      if (!el.isConnected) return; // 대화를 다시 불러와 이 말풍선이 사라졌으면 새 감시가 이어받는다
      // 서버가 30분 지난 작업을 실패로 정리하므로 그보다 조금 더 기다린다
      if (Date.now() - started > 35 * 60 * 1000) {
        el.remove(); watching.delete(id);
        addMsg("model", "분석이 예상보다 오래 걸립니다. 잠시 후 대화를 새로 열어 확인해 주세요.");
        return;
      }
      try {
        const { jobs } = await api("GET", "/jobs");
        const j = jobs.find((x) => x.id === id);
        // 끝났으면(완료·실패·브리핑 대체) 서버가 대화에 저장한 답을 그대로 다시 불러온다. 화면에서 따로 붙이면 두 번 보인다
        if (j && ["done", "failed", "canceled"].includes(j.status)) {
          el.remove(); watching.clear(); chatLoaded = false; loadChat();
          return;
        }
        if (j?.progress) el.querySelector(".dots").textContent = j.progress;
      } catch {}
      setTimeout(tick, 15000);
    };
    setTimeout(tick, 15000);
  }
  async function resumePendingJobs() {
    try {
      const { jobs } = await api("GET", "/jobs");
      for (const j of jobs) if (j.status === "queued" || j.status === "running") watchJob(j.id);
    } catch {}
  }

  // ---------- 문서 ----------
  let currentDoc = null;
  function openDoc(doc) {
    currentDoc = doc;
    const secHtml = (doc.sections || []).map((s) => `
      <section class="doc-sec">
        <h2>${esc(s.heading || "")}</h2>
        ${(s.bullets || []).length ? `<ul>${s.bullets.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
        ${s.table?.headers?.length ? `<table><thead><tr>${s.table.headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${(s.table.rows || []).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table>` : ""}
        ${s.note ? `<p class="doc-note">${esc(s.note)}</p>` : ""}
      </section>`).join("");
    $("#doc-body").innerHTML = `<header class="doc-head"><h1>${esc(doc.title || "")}</h1>${doc.subtitle ? `<p>${esc(doc.subtitle)}</p>` : ""}</header>${secHtml}`;
    $("#doc-pptx").hidden = doc.format !== "pptx";
    $("#doc-dialog").showModal();
  }
  $("#doc-close").addEventListener("click", () => $("#doc-dialog").close());
  $("#doc-pdf").addEventListener("click", () => {
    toast("인쇄 창이 열리면 '대상'을 'PDF로 저장'으로 고르세요.", 7000);
    setTimeout(() => window.print(), 600);
  });
  $("#doc-pptx").addEventListener("click", async (e) => {
    const btn = e.currentTarget; busy(btn, true);
    try { await makePptx(currentDoc); } catch (ex) { toast("발표자료를 만들지 못했습니다. " + (ex.message || ex)); } finally { busy(btn, false); }
  });
  function saveBlob(blob, filename) {
    // dialog 안에서 만든 링크는 클릭이 막힐 수 있어 body 에 붙여 내려받는다
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 2000);
  }

  async function makePptx(doc) {
    // 발표자료 라이브러리(157KB)는 처음 필요할 때만 읽는다
    if (typeof PptxGenJS !== "function") await new Promise((ok) => { const s = document.createElement("script"); s.src = "https://cdn.jsdelivr.net/npm/pptxgenjs@3.12.0/dist/pptxgen.bundle.js"; s.onload = s.onerror = ok; document.head.appendChild(s); });
    if (typeof PptxGenJS !== "function") throw new Error("발표자료 기능을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 해주세요.");
    const P = new PptxGenJS();
    P.layout = "LAYOUT_16x9";
    const FONT = "맑은 고딕", INK = "1F2328", MUTED = "6B7280", BRAND = "A8562A";
    let s = P.addSlide();
    s.background = { color: "FFFFFF" };
    s.addShape(P.ShapeType.rect, { x: 0, y: 2.35, w: 1.2, h: 0.09, fill: { color: BRAND } });
    s.addText(doc.title || "", { x: 0.9, y: 2.6, w: 8.2, h: 1.1, fontSize: 38, bold: true, color: INK, fontFace: FONT });
    if (doc.subtitle) s.addText(doc.subtitle, { x: 0.9, y: 3.7, w: 8.2, h: 0.5, fontSize: 16, color: MUTED, fontFace: FONT });
    s.addShape(P.ShapeType.rect, { x: 0.9, y: 2.45, w: 0.9, h: 0.06, fill: { color: BRAND } });
    for (const sec of doc.sections || []) {
      const sl = P.addSlide();
      sl.background = { color: "FFFFFF" };
      sl.addText(sec.heading || "", { x: 0.6, y: 0.45, w: 8.8, h: 0.7, fontSize: 26, bold: true, color: INK, fontFace: FONT });
      sl.addShape(P.ShapeType.rect, { x: 0.6, y: 1.15, w: 0.7, h: 0.05, fill: { color: BRAND } });
      let y = 1.5;
      if ((sec.bullets || []).length) {
        sl.addText(sec.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022" }, breakLine: true } })),
          { x: 0.7, y, w: 8.6, h: Math.min(3.0, 0.45 * sec.bullets.length + 0.2), fontSize: 16, color: INK, fontFace: FONT, lineSpacingMultiple: 1.25, valign: "top" });
        y += Math.min(3.0, 0.45 * sec.bullets.length + 0.3);
      }
      if (sec.table?.headers?.length) {
        const head = sec.table.headers.map((h) => ({ text: String(h), options: { bold: true, color: "FFFFFF", fill: { color: BRAND } } }));
        const body = (sec.table.rows || []).map((r) => r.map((c) => ({ text: String(c) })));
        sl.addTable([head, ...body], { x: 0.7, y: Math.min(y, 3.6), w: 8.6, fontSize: 13, color: INK, fontFace: FONT, border: { pt: 0.5, color: "D9DCE1" }, align: "left", valign: "middle", rowH: 0.34 });
      }
      if (sec.note) sl.addText(sec.note, { x: 0.7, y: 4.85, w: 8.6, h: 0.4, fontSize: 11, color: MUTED, fontFace: FONT, italic: true });
    }
    const blob = await P.write({ outputType: "blob" });
    saveBlob(blob, (doc.title || "발표자료").replace(/[\\/:*?"<>|]/g, "").slice(0, 60) + ".pptx");
    toast("발표자료를 저장했습니다. 폰은 다운로드 폴더, PC는 다운로드 창에서 열어보세요.", 7000);
  }

  // ---------- 시작 ----------
  buildNav();
  window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (me && VIEWS.some((v) => v.id === h)) go(h, false); });
  // 시작할 때 인터넷·서버 문제면 로그인 화면으로 보내지 않고 연결될 때까지 다시 시도한다 (로그인 만료는 api 가 로그인 화면으로 보낸다)
  function startApp() {
    enter().catch(() => {
      if (!token) return;
      $("#app").hidden = true; $("#lock").hidden = false;
      $("#lock-form").hidden = true; $("#lock-mode").hidden = true;
      $("#lock-sub").textContent = "인터넷 연결을 확인해 주세요. 연결되면 자동으로 들어갑니다.";
      setTimeout(startApp, 5000);
    });
  }
  if (token) startApp(); else showLock();
})();
