// Gemini generateContent + 함수 호출 루프
const API = "https://generativelanguage.googleapis.com/v1beta/models";

export const TOOL_DECLS = [
  { name: "get_quote", description: "국내 주식·ETF 현재가와 퇴직연금 계좌 투자가능 판정을 가져온다. 종목명 일부나 코드로 검색.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "종목명 또는 6자리 코드" } }, required: ["query"] } },
  { name: "simulate_buy", description: "특정 종목을 주어진 수량 사면 위험자산 비중(70% 한도)이 얼마가 되는지 계산한다.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, qty: { type: "INTEGER" } }, required: ["query", "qty"] } },
  { name: "list_holdings", description: "사용자의 보유 종목 목록과 현재 위험자산 비중을 가져온다.", parameters: { type: "OBJECT", properties: {} } },
  { name: "set_holding", description: "보유 종목을 등록하거나 갱신한다(같은 종목이 있으면 덮어씀). 수량을 알면 qty, 비중만 알면 weight_pct 에 넣는다. 둘 중 하나는 반드시 있어야 한다. qty 를 0 으로 주면 삭제.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "종목명 또는 코드" }, qty: { type: "INTEGER", description: "보유 수량(주). 모르면 생략" }, weight_pct: { type: "NUMBER", description: "계좌에서 차지하는 비중(%). 수량을 모를 때 쓴다" }, avg_price: { type: "INTEGER", description: "평균 매수가(원), 모르면 생략" } }, required: ["query"] } },
  { name: "set_total_balance", description: "퇴직연금 계좌 전체 적립금(원)을 저장한다. 70% 한도 계산에 쓰인다.", parameters: { type: "OBJECT", properties: { amount: { type: "INTEGER" } }, required: ["amount"] } },
  { name: "add_trade", description: "매매일지에 매수/매도 기록을 남긴다. 이유·목표가·손절선은 사용자가 말했을 때만 넣는다.", parameters: { type: "OBJECT", properties: { query: { type: "STRING" }, side: { type: "STRING", enum: ["buy", "sell"] }, qty: { type: "INTEGER" }, price: { type: "INTEGER" }, trade_date: { type: "STRING", description: "YYYY-MM-DD, 생략 시 오늘" }, reason: { type: "STRING" }, target_price: { type: "INTEGER" }, stop_price: { type: "INTEGER" } }, required: ["query", "side", "qty", "price"] } },
  { name: "list_trades", description: "매매일지를 기간으로 조회한다(복기용).", parameters: { type: "OBJECT", properties: { from: { type: "STRING", description: "YYYY-MM-DD" }, to: { type: "STRING" } } } },
  { name: "add_event", description: "일정을 추가한다. 반복 일정(매주 미사·탁구)은 repeat 지정.", parameters: { type: "OBJECT", properties: { title: { type: "STRING" }, start_at: { type: "STRING", description: "YYYY-MM-DD HH:MM 한국시간" }, repeat: { type: "STRING", enum: ["none", "daily", "weekly"] }, remind_min: { type: "INTEGER", description: "몇 분 전에 알릴지, 기본 30" } }, required: ["title", "start_at"] } },
  { name: "list_events", description: "다가오는 일정을 가져온다.", parameters: { type: "OBJECT", properties: { days: { type: "INTEGER", description: "며칠치, 기본 7" } } } },
  { name: "delete_event", description: "일정을 삭제한다.", parameters: { type: "OBJECT", properties: { id: { type: "INTEGER" } }, required: ["id"] } },
  { name: "save_memory", description: "사용자가 말한 투자 원칙·선호·관심사처럼 다음 대화에도 기억해야 할 사실을 한 줄로 저장한다.", parameters: { type: "OBJECT", properties: { content: { type: "STRING" } }, required: ["content"] } },
  { name: "my_style", description: "사용자의 매매일지를 분석해 투자 성향(평균 보유기간, 매매 주기, 승률, 평균 손익, 목표가·손절선을 세우는 비율)을 가져온다. '나한테 맞는지', '장기로 들까 단기로 들까', '내 매매 습관' 같은 질문에 반드시 먼저 부른다.", parameters: { type: "OBJECT", properties: {} } },
  { name: "risk_profile", description: "종목의 위험 성격(최근 변동성, 최대 낙폭, 증권사 목표주가 컨센서스)을 가져온다. 종목이 안전한지, 오래 들고 갈 만한지 물을 때 my_style 과 함께 부른다.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "종목명 또는 6자리 코드" } }, required: ["query"] } },
  { name: "get_financials", description: "기업의 재무제표(매출액·영업이익·순이익·ROE·부채비율·EPS·PER·PBR·주당배당금)와 시가총액·52주 최고저 같은 투자지표를 가져온다. 기업 분석이나 보고서를 쓸 때 반드시 먼저 부른다. ETF는 재무제표가 없다.", parameters: { type: "OBJECT", properties: { query: { type: "STRING", description: "종목명 또는 6자리 코드" }, period: { type: "STRING", enum: ["annual", "quarter"], description: "연간(기본) 또는 분기" } }, required: ["query"] } },
  { name: "deep_research", description: "시간이 오래 걸리는 깊은 조사·분석을 뒤에서 처리하도록 맡긴다. 여러 종목 비교, 업종 전반 조사, 포트폴리오 전체 점검처럼 한 번에 답하기 어려운 요청에만 쓴다. 간단한 질문에는 절대 쓰지 않는다. 맡긴 뒤에는 결과를 지어내지 말고 '준비되면 알려드리겠습니다'라고만 답한다.", parameters: { type: "OBJECT", properties: { request: { type: "STRING", description: "무엇을 조사·분석할지 구체적으로" }, context: { type: "STRING", description: "이미 알고 있는 보유 종목·성향 등 참고 자료" } }, required: ["request"] } },
  {
    name: "make_document",
    description: "사용자가 보고서·문서·PDF·발표자료(PPT)를 만들어 달라고 할 때 부른다. 내용을 슬라이드/섹션 양식에 맞춰 채우면 화면이 실제 파일로 만들어 내려준다. 표와 글머리표를 적극 쓰고, 제목은 30자, 글머리표는 한 줄 60자 안쪽으로 짧게 쓴다.",
    parameters: {
      type: "OBJECT",
      properties: {
        format: { type: "STRING", enum: ["pdf", "pptx"], description: "pdf=읽는 문서, pptx=발표자료" },
        title: { type: "STRING", description: "문서 제목, 30자 이내" },
        subtitle: { type: "STRING", description: "부제 또는 작성일·출처 한 줄" },
        sections: {
          type: "ARRAY",
          description: "문서의 각 장(PPT에서는 슬라이드 한 장). 4~8개가 적당하다.",
          items: {
            type: "OBJECT",
            properties: {
              heading: { type: "STRING", description: "장 제목, 30자 이내" },
              bullets: { type: "ARRAY", description: "핵심 문장 3~5개, 각 60자 이내", items: { type: "STRING" } },
              table: {
                type: "OBJECT",
                description: "숫자를 보여줄 때만 넣는다. 열 4개·행 6개 이내.",
                properties: { headers: { type: "ARRAY", items: { type: "STRING" } }, rows: { type: "ARRAY", items: { type: "ARRAY", items: { type: "STRING" } } } },
              },
              note: { type: "STRING", description: "출처나 주의사항 한 줄" },
            },
            required: ["heading"],
          },
        },
      },
      required: ["format", "title", "sections"],
    },
  },
];

/**
 * @param {object} p  { system, history:[{role,parts}], userParts:[...], runTool:(name,args)=>Promise<object>, env }
 * @returns {Promise<{text:string, usage:{in:number,out:number}, calls:string[]}>}
 */
export async function chat({ system, history, userParts, runTool, env, model: override }) {
  const model = override || env.GEMINI_MODEL || "gemini-3.8-flash";
  const contents = [...history, { role: "user", parts: userParts }];
  const usage = { in: 0, out: 0 };
  const calls = [];
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${API}/${model}:generateContent?key=${env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        tools: [{ functionDeclarations: TOOL_DECLS }, { googleSearch: {} }],
        tool_config: { include_server_side_tool_invocations: true },
        generationConfig: { temperature: 0.4, maxOutputTokens: 1500 },
      }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`Gemini ${r.status}: ${j.error?.message || ""}`);
    usage.in += j.usageMetadata?.promptTokenCount || 0;
    usage.out += j.usageMetadata?.candidatesTokenCount || 0;
    const parts = j.candidates?.[0]?.content?.parts || [];
    const fcalls = parts.filter((p) => p.functionCall);
    if (!fcalls.length) {
      return { text: parts.map((p) => p.text || "").join("").trim() || "(답변을 만들지 못했습니다)", usage, calls };
    }
    contents.push({ role: "model", parts });
    const responses = [];
    for (const { functionCall: fc } of fcalls) {
      calls.push(fc.name);
      let out;
      try { out = await runTool(fc.name, fc.args || {}); } catch (e) { out = { error: String(e.message || e) }; }
      responses.push({ functionResponse: { name: fc.name, response: { result: out } } });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { text: "도구 호출이 너무 길어져 멈췄습니다. 다시 물어봐 주세요.", usage, calls };
}
