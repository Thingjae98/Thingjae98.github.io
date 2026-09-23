"""판정표 주간 자동 갱신: 새로 만들고 → 안전 검사 → 통과하면 서버에 배포.

작업 스케줄러 "family-agent-etf-rules"이 매주 월요일 07:00 에 실행한다 (PC 가 켜져 있을 때만).
끄는 법: schtasks /Delete /TN "family-agent-etf-rules" /F   (또는 작업 스케줄러 화면에서 삭제)
로그: data/update_rules.log
"""
import json, os, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
WORKER = os.path.join(HERE, "..", "worker")
NEW = os.path.join(HERE, "etf_rules.json")
LIVE = os.path.join(WORKER, "src", "etf_rules.json")
LOG = os.path.join(HERE, "update_rules.log")


def log(msg):
    line = time.strftime("%Y-%m-%d %H:%M:%S ") + msg
    print(line)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def stats(path):
    d = json.load(open(path, encoding="utf-8"))
    return len(d), sum(1 for v in d.values() if v.get("est"))


def main():
    old_n, old_est = stats(LIVE)
    # 윈도우 기본 인코딩(cp949)으로는 한글 출력이 깨져 수집 스크립트가 죽으므로 UTF-8 로 돌린다
    r = subprocess.run([sys.executable, "build_etf_rules.py"], cwd=HERE, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=1800, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if r.returncode != 0:
        log(f"중단: 수집 실패 (코드 {r.returncode}) {r.stderr.strip()[-300:]}")
        return 1
    new_n, new_est = stats(NEW)
    # 안전 검사: 수집이 반쯤 실패한 표로 서버를 덮어쓰지 않는다
    if new_n < 1000 or new_n < old_n * 0.9:
        log(f"중단: 종목 수 이상 (지난번 {old_n} → 이번 {new_n})")
        return 1
    if new_est > old_est + 100:
        log(f"중단: 추정 종목이 급증 (지난번 {old_est} → 이번 {new_est}). 운용사 공시 수집이 실패했을 수 있음")
        return 1
    shutil.copyfile(NEW, LIVE)
    d = subprocess.run("npx wrangler deploy", cwd=WORKER, shell=True, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=600, env={**os.environ, "CI": "true"})
    if d.returncode != 0:
        log(f"중단: 배포 실패 {d.stderr.strip()[-300:]}")
        return 1
    log(f"완료: {old_n}종(추정 {old_est}) → {new_n}종(추정 {new_est}) 배포")
    return 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        sys.exit(main())
    except Exception as e:
        log(f"중단: 예외 {e!r}"[:400])
        sys.exit(1)
