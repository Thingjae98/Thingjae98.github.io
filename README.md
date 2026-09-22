# family-agent

개인용 비서 웹앱. 대화로 국내 ETF 시세와 퇴직연금 계좌 투자가능 여부를 확인하고, 매매 기록과 일정을 관리한다.

- `docs/` — 화면(PWA). GitHub Pages로 서비스된다.
- `worker/` — 서버(Cloudflare Worker + D1). 모델 호출, 시세 조회, 규정 판정, 일정 알림.
- `data/` — 운용사 공개 페이지에서 퇴직연금 투자가능 비율을 모으는 수집기.

주문 실행 기능은 없다. 매매는 증권사 앱에서 직접 한다.

## 서버 배포

```
cd worker
npx wrangler login
npx wrangler d1 create family-agent          # 출력된 database_id 를 wrangler.toml 에 기입
npx wrangler d1 migrations apply family-agent --remote
node scripts-gen-vapid.mjs                   # 출력 두 줄을 아래 secret 으로
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put VAPID_PUBLIC
npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler deploy
```

배포 후 나온 주소를 `docs/config.js` 에 적고, `worker/wrangler.toml` 의 `ALLOWED_ORIGIN` 을 화면 주소와 맞춘다.

## 사용자 추가

```
cd worker && node invite.mjs "이름"
```

발급된 초대 코드로 앱에서 비밀번호 4자리를 정하면 등록된다.

## 판정표 갱신

```
cd data && python build_etf_rules.py && cp etf_rules.json ../worker/src/
```
