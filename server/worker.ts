import { rm } from 'node:fs/promises';
import { db, event } from './db.ts';
import { filePath } from './config.ts';
import { normalizeFile, renderOrder } from './pdf.ts';
import type { FileRow, OrderRow, Snapshot } from './types.ts';
let busy = false;
export function recover() { db.exec("UPDATE files SET status='queued' WHERE status='processing'; UPDATE orders SET error=NULL WHERE status='generating';"); }
export async function tick() {
  if (busy) return; busy = true;
  try {
    const f = db.prepare("SELECT * FROM files WHERE status='queued' ORDER BY created LIMIT 1").get() as FileRow | undefined;
    if (f) {
      db.prepare("UPDATE files SET status='processing',error=NULL WHERE id=?").run(f.id);
      try { const pages = await normalizeFile(f); db.prepare("UPDATE files SET status='ready',pages=?,error=NULL WHERE id=?").run(pages, f.id); }
      catch (e) { db.prepare("UPDATE files SET status='failed',error=? WHERE id=?").run(e instanceof Error ? e.message : '转换失败', f.id); }
    }
    const o = db.prepare("SELECT * FROM orders WHERE status='generating' ORDER BY created LIMIT 1").get() as OrderRow | undefined;
    if (o) {
      try { const pages = await renderOrder(o); db.prepare("UPDATE orders SET status='ready',output_pages=?,error=NULL WHERE id=?").run(pages, o.id); event(o.id, '待打印 PDF 已生成（未发送到实体打印机）'); }
      catch { db.prepare("UPDATE orders SET status='failed',error=? WHERE id=?").run('输出生成失败，请联系商家检查字体、源文件及磁盘空间后重试。', o.id); event(o.id, '待打印文件生成失败'); }
    }
  } finally { busy = false; }
}
export async function cleanup(now = Date.now()) {
  if (busy) return;
  busy = true;
  try {
    const protectedIds = new Set<string>();
    for (const o of db.prepare("SELECT snapshot FROM orders WHERE status='generating'").all() as { snapshot: string }[]) for (const id of (JSON.parse(o.snapshot) as Snapshot).fileIds) protectedIds.add(id);
    for (const f of db.prepare("SELECT * FROM files WHERE expires<=? AND status NOT IN ('processing','queued','expired')").all(now) as FileRow[]) {
      if (protectedIds.has(f.id)) continue;
      await rm(filePath(f.id, 'original', f.ext), { force: true }); await rm(filePath(f.id, 'converted'), { force: true });
      db.prepare("UPDATE files SET status='expired',error=NULL WHERE id=?").run(f.id);
    }
    for (const o of db.prepare("SELECT * FROM orders WHERE expires<=? AND status NOT IN ('generating','expired')").all(now) as OrderRow[]) {
      await rm(filePath(o.id, 'output'), { force: true });
      db.prepare("UPDATE orders SET status='expired',error=NULL WHERE id=?").run(o.id);
    }
    db.prepare('DELETE FROM sessions WHERE expires<?').run(now);
    db.prepare('DELETE FROM quotes WHERE created<? AND id NOT IN (SELECT quote_id FROM orders)').run(now - 3600_000);
  } finally { busy = false; }
}
