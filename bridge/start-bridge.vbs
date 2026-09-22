' 가족 비서 로컬 브릿지를 창 없이 실행한다.
' 끄는 법: 작업 관리자에서 node.exe 종료, 또는 시작프로그램 폴더의 바로가기를 삭제 후 재부팅.
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\Users\soave\family-agent\bridge"
sh.Run "cmd /c node worker.mjs >> bridge.log 2>&1", 0, False
