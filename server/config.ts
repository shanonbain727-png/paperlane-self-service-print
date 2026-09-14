import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
export const root = process.cwd();
export const config = {
  port: Number(process.env.PORT || 8787), host: process.env.HOST || '127.0.0.1',
  publicUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  data: path.resolve(process.env.DATA_DIR || 'data'),
  font: path.resolve(process.env.FONT_PATH || 'assets/NotoSansSC.ttf'),
  adminPassword: process.env.ADMIN_PASSWORD || '',
};
export function sofficePath() {
  return [process.env.SOFFICE_PATH, path.join(root, '.tools/lo-package/program/soffice.com'), 'C:/Program Files/LibreOffice/program/soffice.com', '/usr/bin/libreoffice', '/usr/bin/soffice'].find((p): p is string => !!p && existsSync(p));
}
export function prepareDirs() { for (const d of ['original', 'converted', 'output', 'tmp']) mkdirSync(path.join(config.data, d), { recursive: true }); }
export const filePath = (id: string, kind: 'original' | 'converted' | 'output', ext = 'pdf') => path.join(config.data, kind, `${id}.${ext}`);
