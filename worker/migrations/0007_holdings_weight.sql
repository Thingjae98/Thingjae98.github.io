-- 수량을 모르고 비중(%)만 아는 보유 종목을 넣을 수 있게 한다.
-- SQLite 는 NOT NULL 을 없앨 수 없어 테이블을 다시 만든다.
CREATE TABLE holdings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  code TEXT,
  name TEXT NOT NULL,
  qty INTEGER,
  avg_price INTEGER,
  weight_pct REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
INSERT INTO holdings_new (id, user_id, code, name, qty, avg_price, weight_pct, updated_at)
  SELECT id, user_id, code, name, qty, avg_price, NULL, updated_at FROM holdings;
DROP TABLE holdings;
ALTER TABLE holdings_new RENAME TO holdings;
