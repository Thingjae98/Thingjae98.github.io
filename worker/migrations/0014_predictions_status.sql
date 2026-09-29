-- 전망 적중 기록(관리자 전용). 브리핑·깊게 답의 전망을 저장하고 14일 뒤 실제 수익률로 채점한다.
CREATE TABLE predictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  source TEXT NOT NULL,            -- brief | deep
  made_at TEXT NOT NULL,           -- 한국시간
  grp TEXT NOT NULL,               -- 묶음 이름
  codes TEXT NOT NULL,             -- 종목코드 쉼표 구분
  view TEXT NOT NULL,              -- up | down | flat
  confidence TEXT,                 -- low | mid | high
  action TEXT,                     -- add | hold | reduce
  base TEXT NOT NULL,              -- 기준가 JSON {code: price}
  due_at TEXT NOT NULL,            -- 채점 날짜(made_at + 14일)
  eval_at TEXT, ret REAL, actual TEXT, hit INTEGER
);
CREATE INDEX idx_pred_due ON predictions(eval_at, due_at);

-- 상태 점검용 작은 저장소 (브릿지 마지막 응답 시각 등)
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT, updated_at TEXT);
