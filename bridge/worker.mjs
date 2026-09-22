/**
 * 로컬 브릿지: 이 PC에서 돌면서 서버의 무거운 작업을 가져다 클로드 코드로 처리하고 결과를 돌려보낸다.
 *
 *   실행:   node worker.mjs           (한 번 확인용)
 *   끄기:   창을 닫거나 Ctrl+C. 시작프로그램에 넣었다면 그 바로가기를 지운다.
 *
 * 환경변수(.env 또는 시스템):
 *   FA_API       서버 주소            기본 https://family-agent.mj98531.workers.dev
 *   FA_WORKER_KEY 작업자 열쇠          (서버 secret WORKER_KEY 와 같아야 함)
 *   FA_POLL_SEC  확인 주기(초)         기본 20
 *   FA_MAX_PER_DAY 하루 최대 처리 건수  기본 20 (과도한 사용을 막는 안전장치)
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
// .env 읽기 (있으면)
try {
  for (const line of fs.readFileSync(path.join(here, ".env"), "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} catch {}

const API = process.env.FA_API || "https://family-agent.mj98531.workers.dev";
const KEY = process.env.FA_WORKER_KEY;
const POLL = Number(process.env.FA_POLL_SEC || 20) * 1000;
const MAX_PER_DAY = Number(process.env.FA_MAX_PER_DAY || 20);
const TIMEOUT_MS = 10 * 60 * 1000;

if (!KEY) { console.error("FA_WORKER_KEY 가 없습니다. bridge/.env 에 넣어주세요."); process.exit(1); }

let today = "";
let doneToday = 0;
const log = (...a) => console.log(new Date().toLocaleTimeString("ko-KR"), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function claim() {
  const r = await fetch(API + "/worker/claim", { method: "POST", headers: { "X-Worker-Key": KEY, "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error("claim " + r.status);
  return (await r.json()).job;
}

async function report(job_id, result, error) {
  const r = await fetch(API + "/worker/result", {
    method: "POST",
    headers: { "X-Worker-Key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ job_id, result, error }),
  });
  if (!r.ok) log("결과 전송 실패", r.status, await r.text().catch(() => ""));
}

/** 클로드 코드를 한 번 호출한다. 실패하면 에러 문자열을 던진다. */
function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    // stdin 을 닫아야 claude 가 입력을 기다리지 않는다. 인자는 배열로 넘겨 이스케이프 문제를 피한다.
    // 조사에 필요한 읽기 전용 도구만 연다. 파일 쓰기·명령 실행은 주지 않는다.
    const args = ["-p", prompt, "--allowedTools", "WebSearch", "WebFetch"];
    const p = spawn("claude", args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { p.kill(); reject(new Error("10분을 넘겨 중단했습니다")); }, TIMEOUT_MS);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) => { clearTimeout(timer); reject(e); });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(err.trim().slice(0, 300) || `클로드 종료 코드 ${code}`));
    });
  });
}

function buildPrompt(job) {
  const u = job.user || {};
  return [
    `당신은 ${u.name || "사용자"}${u.honorific || "님"}의 개인 투자 비서다. 아래 요청에 대해 조사하고 분석해 답하라.`,
    `말투: ${u.tone || "존댓말로 간결하게"}`,
    u.account_type === "general"
      ? "이 사용자는 일반 위탁계좌를 쓴다. 퇴직연금 규제는 적용되지 않는다."
      : "이 사용자는 퇴직연금(DC/IRP) 계좌를 쓴다. 개별주식·레버리지·인버스는 매수 불가이고 위험자산은 70% 한도다.",
    "",
    "규칙:",
    "- 특정 종목의 매수·매도를 권하지 않는다. 판단 재료를 정리하고 결정은 사용자에게 맡긴다.",
    "- 주가가 오를지 내릴지 단정하지 않는다. 숫자는 근거가 있는 것만 쓰고 지어내지 않는다.",
    "- 읽는 사람은 60대다. 어려운 용어는 처음 나올 때 괄호로 풀어 쓴다.",
    "- 마크다운 표를 적극 쓰고, 전체 1500자 안쪽으로 정리한다.",
    "- 세금·규정 이야기에는 '최종 확인은 증권사나 세무사에게' 를 덧붙인다.",
    "",
    "요청:",
    job.prompt,
    job.context ? "\n참고 자료:\n" + job.context : "",
  ].join("\n");
}

async function loop() {
  log(`브릿지 시작. 서버 ${API}, ${POLL / 1000}초마다 확인, 하루 최대 ${MAX_PER_DAY}건`);
  for (;;) {
    try {
      const d = new Date().toISOString().slice(0, 10);
      if (d !== today) { today = d; doneToday = 0; }
      if (doneToday >= MAX_PER_DAY) { log(`하루 상한 ${MAX_PER_DAY}건에 도달. 내일 다시 처리합니다.`); await sleep(60 * 60 * 1000); continue; }

      const job = await claim();
      if (!job) { await sleep(POLL); continue; }

      log(`작업 #${job.id} 시작: ${job.prompt.slice(0, 50)}`);
      const started = Date.now();
      try {
        const out = await runClaude(buildPrompt(job));
        await report(job.id, out, null);
        doneToday++;
        log(`작업 #${job.id} 완료 (${Math.round((Date.now() - started) / 1000)}초, 오늘 ${doneToday}건)`);
      } catch (e) {
        await report(job.id, null, String(e.message || e));
        log(`작업 #${job.id} 실패: ${e.message || e}`);
      }
    } catch (e) {
      log("서버 연결 실패, 잠시 후 다시 시도:", e.message || e);
      await sleep(POLL * 3);
    }
  }
}

loop();
