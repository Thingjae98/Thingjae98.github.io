-- 관리자 권한과 계좌 종류
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'pension'; -- pension(퇴직연금 전용) | general(일반 위탁)
UPDATE users SET is_admin = 1 WHERE id = 1;
