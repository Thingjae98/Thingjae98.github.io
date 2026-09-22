-- 무거운 작업을 로컬 PC(클로드 코드)로 넘기기 위한 작업 대기줄
CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  prompt TEXT NOT NULL,            -- 로컬에서 실행할 요청문
  context TEXT,                    -- 참고 자료(JSON 문자열)
  status TEXT NOT NULL DEFAULT 'queued',  -- queued | running | done | failed | canceled
  result TEXT,
  error TEXT,
  claimed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours')),
  finished_at TEXT
);
CREATE INDEX idx_jobs_status ON jobs(status, id);
CREATE INDEX idx_jobs_user ON jobs(user_id, id);
