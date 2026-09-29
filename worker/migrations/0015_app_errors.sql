-- 사진 등록 등이 실패했을 때 사유를 남긴다 (관리 탭 상태 점검에 최근 것을 보여준다)
CREATE TABLE app_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  place TEXT NOT NULL,       -- 예: photo-read, photo-client
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','+9 hours'))
);
