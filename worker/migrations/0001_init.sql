-- 가족 금융비서 스키마. 사용자별 데이터는 user_id 로 완전 분리.
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL UNIQUE,          -- 초대 코드 = 로그인 아이디(영문+숫자 8자)
  name TEXT NOT NULL,                   -- 사용자 이름(호칭에 쓰임)
  pin_hash TEXT,                        -- 등록 전에는 NULL
  agent_name TEXT NOT NULL DEFAULT '비서',
  honorific TEXT NOT NULL DEFAULT '님', -- 이름 뒤에 붙는 호칭
  tone TEXT NOT NULL DEFAULT '존댓말로, 두세 문장 이내로 짧게, 어려운 용어는 처음 나올 때 괄호로 풀어서',
  push_enabled INTEGER NOT NULL DEFAULT 0,
  total_balance INTEGER,                -- 퇴직연금 전체 적립금(원). 70% 한도 계산용
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL,                   -- user | model
  content TEXT NOT NULL,
  has_image INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX idx_messages_user ON messages(user_id, id);
CREATE TABLE holdings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT,                            -- 6자리 종목코드(모르면 NULL)
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  avg_price INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  trade_date TEXT NOT NULL,             -- YYYY-MM-DD
  code TEXT,
  name TEXT NOT NULL,
  side TEXT NOT NULL,                   -- buy | sell
  qty INTEGER NOT NULL,
  price INTEGER NOT NULL,
  reason TEXT,
  target_price INTEGER,
  stop_price INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,               -- YYYY-MM-DD HH:MM (한국시간)
  repeat TEXT NOT NULL DEFAULT 'none',  -- none | daily | weekly
  remind_min INTEGER NOT NULL DEFAULT 30,
  last_notified TEXT,                   -- 마지막으로 알림 보낸 발생일시
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE push_subs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE TABLE push_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  title TEXT
);
CREATE TABLE usage_log (                -- LLM 호출 비용 감시
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  in_tokens INTEGER, out_tokens INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
