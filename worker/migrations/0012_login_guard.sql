-- 비밀번호 5번 틀리면 15분 잠금, 초대·초기화 후 24시간 안에만 비밀번호 등록 가능
ALTER TABLE users ADD COLUMN fail_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN locked_until TEXT;
ALTER TABLE users ADD COLUMN pin_reset_at TEXT;
