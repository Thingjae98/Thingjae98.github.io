-- Cloudflare(UTC)에서 SQLite 의 'localtime' 이 UTC 를 돌려줘 모든 기록 시각이 9시간 밀렸다.
-- 이미 저장된 행을 한국시간으로 옮긴다. (이 마이그레이션 이후 INSERT 는 코드에서 +9 hours 로 명시)
UPDATE messages SET created_at = datetime(created_at, '+9 hours');
UPDATE trades   SET created_at = datetime(created_at, '+9 hours');
UPDATE holdings SET updated_at = datetime(updated_at, '+9 hours');
UPDATE memories SET created_at = datetime(created_at, '+9 hours');
UPDATE events   SET created_at = datetime(created_at, '+9 hours');
UPDATE push_log SET sent_at    = datetime(sent_at,    '+9 hours');
UPDATE usage_log SET created_at = datetime(created_at, '+9 hours');
UPDATE users    SET created_at = datetime(created_at, '+9 hours');
