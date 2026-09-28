-- 답변 방식(빠르게·기본·깊게)을 기기별이 아니라 계정별로 저장한다. NULL 이면 기본(smart)
ALTER TABLE users ADD COLUMN chat_mode TEXT;
-- 사용 기록에 어느 방식으로 물었는지 남긴다 (fast | smart | brief)
ALTER TABLE usage_log ADD COLUMN mode TEXT;
