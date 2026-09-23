-- 깊게 모드 진행 상황("자료 찾는 중" 등)을 화면에 보여주기 위한 칸
ALTER TABLE jobs ADD COLUMN progress TEXT;
