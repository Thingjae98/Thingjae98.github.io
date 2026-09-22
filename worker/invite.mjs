// 초대 코드 발급: node invite.mjs "이름" [--local]  → 코드 출력. 그 코드로 앱에서 PIN을 정하면 등록 완료
import { execSync } from "node:child_process";
const name = process.argv[2];
if (!name) { console.error("사용법: node invite.mjs 이름 [--local]"); process.exit(1); }
const target = process.argv.includes("--local") ? "--local" : "--remote";
const code = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[b % 32]).join("");
const safeName = name.replace(/'/g, "''");
execSync(`npx wrangler d1 execute family-agent ${target} --command "INSERT INTO users (handle, name) VALUES ('${code}', '${safeName}')"`, { stdio: "inherit" });
console.log(`\n초대 코드: ${code}  (이름: ${name})`);
