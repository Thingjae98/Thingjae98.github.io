-- 대화에 딸린 문서(보고서·발표자료)를 저장해 앱을 다시 열어도 볼 수 있게 한다
ALTER TABLE messages ADD COLUMN document TEXT;
