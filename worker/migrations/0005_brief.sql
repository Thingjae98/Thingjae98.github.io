-- 아침 브리핑 설정. 기본 꺼짐, 켠 사람에게만 하루 1회.
ALTER TABLE users ADD COLUMN brief_enabled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN brief_hour INTEGER NOT NULL DEFAULT 8;   -- 한국시간 기준 시(7~11)
ALTER TABLE users ADD COLUMN brief_last TEXT;                          -- 마지막 발송일(YYYY-MM-DD)
