import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
mkdirSync('data', { recursive: true });
if (!existsSync('.env')) {
  writeFileSync('.env', `PORT=8787\nHOST=127.0.0.1\nPUBLIC_BASE_URL=http://localhost:5173\nADMIN_PASSWORD=${randomBytes(18).toString('base64url')}\nDATA_DIR=./data\nPAYMENT_MODE=mock\n`);
  console.log('已生成 .env，商家后台密码保存在 ADMIN_PASSWORD。请妥善保存。');
} else console.log('保留现有 .env 配置。');
