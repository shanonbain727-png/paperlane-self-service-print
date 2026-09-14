import express, { type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import cookieParser from 'cookie-parser';
import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rename, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { ZodError, z } from 'zod';
import { config, filePath, sofficePath } from './config.ts';
import { db, settings, onboarding, transaction, event, checkPassword, hashPassword } from './db.ts';
import { makeSnapshot, optionsSchema, settingsSchema, AppError } from './domain.ts';
import { mockPayment } from './pdf.ts';
import type { FileRow, OrderRow, Snapshot } from './types.ts';
import { PrinterService } from './printers.ts';
type AuthedRequest = Request & { guest: string; admin: boolean };
const attempts = new Map<string, { count: number; until: number }>();
const noCache = (_req: Request, res: Response, next: NextFunction) => { res.setHeader('Cache-Control', 'no-store'); next(); };
const auth = (req: Request) => req as AuthedRequest;
const adminOnly = (req: Request, _res: Response, next: NextFunction) => auth(req).admin ? next() : next(new AppError(401, '请先登录商家后台。'));
const getFile = (id: string) => db.prepare('SELECT * FROM files WHERE id=?').get(id) as FileRow | undefined;
const getOrder = (id: string) => db.prepare('SELECT * FROM orders WHERE id=?').get(id) as OrderRow | undefined;
const presentOrder = (o: OrderRow) => ({ ...o, owner: undefined, snapshot: JSON.parse(o.snapshot), paymentMode: 'mock', outputAvailable: o.status === 'ready' && o.expires > Date.now() && existsSync(filePath(o.id, 'output')) });
function ownedFile(req: Request, id: string) { const f = getFile(id); if (!f || (!auth(req).admin && f.owner !== auth(req).guest)) throw new AppError(404, '文件不存在或无权访问。'); return f; }
function ownedOrder(req: Request, id: string) { const o = getOrder(id); if (!o || (!auth(req).admin && o.owner !== auth(req).guest)) throw new AppError(404, '订单不存在或无权访问。'); return o; }
function session(role: string) { const id = randomBytes(32).toString('hex'); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(id, role, Date.now() + (role === 'admin' ? 12 : 24 * 30) * 3600_000); return id; }
function cookie(res: Response, name: string, value: string, hours: number) { res.cookie(name, value, { httpOnly: true, sameSite: 'strict', secure: config.publicUrl.startsWith('https:'), maxAge: hours * 3600_000, path: '/' }); }
export function createApp(printers = new PrinterService()) {
  const requireSetup = () => { if (!onboarding().completed) throw new AppError(409, '商家尚未完成首次设置，请完成店铺名称、打印机和价格配置。'); };
  const stationReady = async (force = false) => { await printers.requireReady(force); requireSetup(); };
  const setupState = async () => {
    const progress = onboarding(), printer = await printers.state();
    return { ...progress, settings: settings(), printer, step: !progress.identity ? 0 : !printer.ready ? 1 : !progress.pricing ? 2 : 3 };
  };
  const app = express(); app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('X-Frame-Options', 'SAMEORIGIN'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });
  app.use('/api', noCache, cookieParser(), express.json({ limit: '256kb' }));
  app.use('/api', (req, res, next) => {
    if (req.method !== 'GET' && req.headers.origin) {
      try { const host = new URL(req.headers.origin).host; if (host !== req.headers.host && host !== new URL(config.publicUrl).host) throw new Error(); }
      catch { return next(new AppError(403, '不允许跨站提交。')); }
    }
    const get = (id: unknown, role: string) => typeof id === 'string' && db.prepare('SELECT id FROM sessions WHERE id=? AND role=? AND expires>?').get(id, role, Date.now());
    let guest = req.cookies?.guest;
    if (!get(guest, 'guest')) { guest = session('guest'); cookie(res, 'guest', guest, 24 * 30); }
    auth(req).guest = guest; auth(req).admin = !!get(req.cookies?.merchant, 'admin'); next();
  });
  app.get('/api/device', async (_req, res) => {
    const printer = await printers.state(), shop = settings();
    res.json({ id: 'station-1', ...shop, accepting: shop.accepting && printer.ready && onboarding().completed, printerReady: printer.ready,
      unavailableReason: !printer.ready ? printer.reason : !onboarding().completed ? '商家尚未完成首次设置，请稍后再来。' : !shop.accepting ? '打印站暂停接单。' : '', paymentMode: 'mock', printerMode: 'artifact', wordReady: !!sofficePath() });
  });
  app.get('/api/files', (req, res) => res.json(db.prepare('SELECT * FROM files WHERE owner=? ORDER BY created').all(auth(req).guest).map(row => ({ ...row, owner: undefined }))));
  const upload = multer({ dest: path.join(config.data, 'tmp'), limits: { fileSize: 30 * 1024 * 1024, files: 1, fields: 0 } });
  app.post('/api/files', upload.single('file'), async (req, res) => {
    if (!req.file) throw new AppError(400, '请选择文件。');
    const temp = req.file.path;
    try {
      await stationReady();
      if (!settings().accepting) throw new AppError(409, '打印站暂停接单，请稍后再来。');
      const total = db.prepare("SELECT coalesce(sum(size),0) AS size, count(*) AS n FROM files WHERE owner=? AND status!='expired'").get(auth(req).guest) as { size: number; n: number };
      if (total.size + req.file.size > 200 * 1024 * 1024 || total.n >= 30) throw new AppError(400, '当前文件暂存空间已满，请删除不需要的文件。');
      let name = req.file.originalname;
      if (/[\u0080-\u00ff]/.test(name)) { const decoded = Buffer.from(name, 'latin1').toString('utf8'); if (!decoded.includes('\uFFFD')) name = decoded; }
      name = path.basename(name.replaceAll('\\', '/')).replace(/[\u0000-\u001f]/g, '').slice(0, 180);
      const ext = path.extname(name).slice(1).toLowerCase();
      if (!['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg'].includes(ext)) throw new AppError(400, '仅支持 PDF、Word、JPG 和 PNG。');
      if (!req.file.size) throw new AppError(400, '不能上传空文件。');
      const bytes = await readFile(temp);
      const valid = ext === 'pdf' ? bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')) : ext === 'docx' ? bytes[0] === 0x50 && bytes[1] === 0x4b : ext === 'doc' ? bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')) : ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a','hex')) : bytes[0] === 0xff && bytes[1] === 0xd8;
      if (!valid) throw new AppError(400, '文件内容与扩展名不符，请检查文件。');
      const id = randomUUID(), now = Date.now();
      await rename(temp, filePath(id, 'original', ext));
      db.prepare('INSERT INTO files(id,owner,name,size,ext,status,created,expires) VALUES(?,?,?,?,?,?,?,?)').run(id, auth(req).guest, name, req.file.size, ext, 'queued', now, now + settings().retentionHours * 3600_000);
      res.status(201).json({ ...getFile(id), owner: undefined });
    } finally { await rm(temp, { force: true }); }
  });
  app.get('/api/files/:id/pdf', (req, res) => { const f = ownedFile(req, String(req.params.id)); if (f.status !== 'ready' || f.expires <= Date.now()) throw new AppError(410, '文件尚未就绪或已经过期。'); res.type('pdf').sendFile(filePath(f.id, 'converted')); });
  app.get('/api/files/:id/thumbnail', async (req, res) => {
    const f = ownedFile(req, String(req.params.id));
    if (f.status !== 'ready' || f.expires <= Date.now()) throw new AppError(410, '图片尚未就绪或已经过期。');
    if (!['png', 'jpg', 'jpeg'].includes(f.ext)) throw new AppError(400, '此文件不是图片。');
    const image = await sharp(filePath(f.id, 'original', f.ext), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    res.type('png').send(image);
  });
  app.post('/api/files/:id/retry', (req, res) => { const f = ownedFile(req, String(req.params.id)); if (f.status !== 'failed' || f.expires <= Date.now()) throw new AppError(409, '仅可重试未过期的失败文件。'); db.prepare("UPDATE files SET status='queued',error=NULL WHERE id=?").run(f.id); res.json({ ok: true }); });
  app.delete('/api/files/:id', async (req, res) => {
    const f = ownedFile(req, String(req.params.id));
    if (['queued', 'processing'].includes(f.status)) throw new AppError(409, '文件正在处理，请稍后删除。');
    const used = (db.prepare("SELECT snapshot FROM orders WHERE owner=? AND status NOT IN ('expired','cancelled')").all(f.owner) as { snapshot: string }[]).some(o => (JSON.parse(o.snapshot) as Snapshot).fileIds.includes(f.id));
    if (used) throw new AppError(409, '文件已关联有效订单，保留至订单过期。');
    await rm(filePath(f.id, 'original', f.ext), { force: true }); await rm(filePath(f.id, 'converted'), { force: true });
    db.prepare('DELETE FROM files WHERE id=?').run(f.id); res.json({ ok: true });
  });
  app.post('/api/quotes', async (req, res) => {
    await stationReady();
    const shop = settings(); if (!shop.accepting) throw new AppError(409, '打印站暂停接单。');
    const input = optionsSchema.parse(req.body); const files = input.fileIds.map(id => ownedFile(req, id));
    const snapshot = makeSnapshot(input, files, shop); const id = randomUUID();
    db.prepare('INSERT INTO quotes VALUES(?,?,?,?)').run(id, auth(req).guest, JSON.stringify(snapshot), Date.now()); res.json({ id, ...snapshot });
  });
  app.post('/api/orders', async (req, res) => {
    const quoteId = z.string().uuid().parse(req.body.quoteId);
    const q = db.prepare('SELECT * FROM quotes WHERE id=? AND owner=?').get(quoteId, auth(req).guest) as { snapshot: string; created: number } | undefined;
    if (!q) throw new AppError(404, '报价不存在。');
    const previous = db.prepare('SELECT * FROM orders WHERE quote_id=?').get(quoteId) as OrderRow | undefined;
    if (previous) return res.json(presentOrder(previous));
    await stationReady(true);
    // Another checkout may have completed while discovery was running.
    const completed = db.prepare('SELECT * FROM orders WHERE quote_id=?').get(quoteId) as OrderRow | undefined;
    if (completed) return res.json(presentOrder(completed));
    if (!settings().accepting) throw new AppError(409, '打印站暂停接单。');
    if (Date.now() - q.created > 15 * 60_000) throw new AppError(409, '报价已过期，请重新确认。');
    const snap: Snapshot = JSON.parse(q.snapshot);
    makeSnapshot(snap, snap.fileIds.map(id => ownedFile(req, id)), snap.settings);
    const id = randomUUID(), now = Date.now(), expires = now + snap.settings.retentionHours * 3600_000;
    let code: string; do { code = String(randomInt(100000, 1000000)); } while (db.prepare('SELECT id FROM orders WHERE code=?').get(code));
    transaction(() => {
      db.prepare('INSERT INTO orders(id,owner,code,quote_id,snapshot,status,paid,created,expires) VALUES(?,?,?,?,?,?,?,?,?)').run(id, auth(req).guest, code, quoteId, q.snapshot, 'generating', 1, now, expires);
      db.prepare('INSERT INTO payments VALUES(?,?,?,?)').run(id, mockPayment.confirm(id).reference, snap.amount, now);
      for (const fid of snap.fileIds) db.prepare('UPDATE files SET expires=max(expires,?) WHERE id=?').run(expires, fid);
      event(id, '创建测试订单');
      event(id, '自动模拟支付成功（未扣款）');
    });
    res.status(201).json(presentOrder(getOrder(id)!));
  });
  app.get('/api/orders', (req, res) => res.json((db.prepare('SELECT * FROM orders WHERE owner=? ORDER BY created DESC').all(auth(req).guest) as OrderRow[]).map(presentOrder)));
  app.get('/api/orders/:id', (req, res) => { const o = ownedOrder(req, String(req.params.id)); res.json({ ...presentOrder(o), events: db.prepare('SELECT action,created FROM events WHERE order_id=? ORDER BY id DESC').all(o.id) }); });
  app.post('/api/orders/:id/pay', async (req, res) => {
    let o = ownedOrder(req, String(req.params.id));
    if (o.paid) return res.json(presentOrder(o));
    await stationReady(true);
    o = ownedOrder(req, String(req.params.id));
    if (o.paid) return res.json(presentOrder(o));
    if (o.status !== 'awaiting_payment' || o.expires <= Date.now()) throw new AppError(409, '订单已取消或过期，无法支付。');
    if (!settings().accepting) throw new AppError(409, '打印站暂停接单，暂时不能支付。');
    const snap: Snapshot = JSON.parse(o.snapshot); makeSnapshot(snap, snap.fileIds.map(id => ownedFile(req, id)), snap.settings);
    transaction(() => {
      db.prepare('INSERT OR IGNORE INTO payments VALUES(?,?,?,?)').run(o.id, mockPayment.confirm(o.id).reference, snap.amount, Date.now());
      db.prepare("UPDATE orders SET status='generating',paid=1 WHERE id=? AND paid=0").run(o.id); event(o.id, '模拟支付成功（未扣款）');
    }); res.json(presentOrder(getOrder(o.id)!));
  });
  app.post('/api/orders/:id/cancel', (req, res) => { const o = ownedOrder(req, String(req.params.id)); if (o.status !== 'awaiting_payment') throw new AppError(409, '仅可取消未支付订单。'); db.prepare("UPDATE orders SET status='cancelled' WHERE id=?").run(o.id); event(o.id, '订单已取消'); res.json(presentOrder(getOrder(o.id)!)); });
  app.get('/api/orders/:id/pdf', (req, res) => { const o = ownedOrder(req, String(req.params.id)); if (o.status !== 'ready' || o.expires <= Date.now()) throw new AppError(410, '文件未生成或已经过期。'); res.download(filePath(o.id, 'output'), `纸间-${o.code}.pdf`); });
  app.get('/api/admin/session', (req, res) => res.json({ authenticated: auth(req).admin, ...(auth(req).admin ? { setupRequired: !onboarding().completed } : {}) }));
  app.post('/api/admin/login', (req, res) => {
    const password = z.string().max(256).parse(req.body.password);
    const key = req.ip || 'local', now = Date.now();
    let attempt = attempts.get(key); if (!attempt || attempt.until < now) { attempt = { count: 0, until: now + 10 * 60_000 }; attempts.set(key, attempt); }
    if (attempt.count >= 10) throw new AppError(429, '尝试次数过多，请十分钟后再试。');
    if (!checkPassword(password)) { attempt.count++; throw new AppError(401, '密码不正确。'); }
    attempts.delete(key); cookie(res, 'merchant', session('admin'), 12); res.json({ ok: true });
  });
  app.post('/api/admin/logout', (req, res) => { if (typeof req.cookies?.merchant === 'string') db.prepare('DELETE FROM sessions WHERE id=?').run(req.cookies.merchant); res.clearCookie('merchant', { path: '/' }); res.json({ ok: true }); });
  app.use('/api/admin', adminOnly);
  app.get('/api/admin/onboarding', async (_req, res) => res.json(await setupState()));
  app.put('/api/admin/onboarding', async (req, res) => {
    const input = z.discriminatedUnion('action', [
      z.object({ action: z.literal('identity'), shopName: settingsSchema.shape.shopName, deviceName: settingsSchema.shape.deviceName, address: settingsSchema.shape.address }),
      z.object({ action: z.literal('printer') }),
      z.object({ action: z.literal('pricing'), simplexPrice: settingsSchema.shape.simplexPrice, duplexPrice: settingsSchema.shape.duplexPrice }),
      z.object({ action: z.literal('complete'), accepting: z.boolean() }),
    ]).parse(req.body);
    if (onboarding().completed) return res.json(await setupState());
    if (input.action !== 'identity' && !onboarding().identity) throw new AppError(409, '请先填写店铺名称。');
    if (input.action !== 'identity') await printers.requireReady(true);
    transaction(() => {
      const progress = onboarding(), next = settings();
      if (progress.completed) return;
      if (input.action === 'identity') { next.shopName = input.shopName; next.deviceName = input.deviceName; next.address = input.address; progress.identity = true; }
      if (input.action === 'pricing') { next.simplexPrice = input.simplexPrice; next.duplexPrice = input.duplexPrice; progress.pricing = true; }
      if (input.action === 'complete') {
        if (!progress.identity || !progress.pricing) throw new AppError(409, '请先完成店铺名称与价格设置。');
        settingsSchema.parse(next); next.accepting = input.accepting; progress.completed = true;
      }
      db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(next));
      db.prepare('UPDATE onboarding SET value=? WHERE id=1').run(JSON.stringify(progress));
    });
    res.json(await setupState());
  });
  app.get('/api/admin/printers', async (_req, res) => res.json(await printers.state(true)));
  app.put('/api/admin/printers/default', async (req, res) => {
    const { name } = z.object({ name: z.string().min(1).max(512) }).parse(req.body);
    res.json(await printers.select(name));
  });
  app.delete('/api/admin/printers/default', async (_req, res) => { printers.disconnect(); res.json(await printers.state()); });
  app.get('/api/admin/overview', (_req, res) => {
    const orders = db.prepare('SELECT * FROM orders ORDER BY created DESC').all() as OrderRow[];
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const todays = orders.filter(o => new Date(o.created).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }) === today);
    res.json({ total: orders.length, today: todays.length, amount: todays.filter(o => o.paid).reduce((n, o) => n + (JSON.parse(o.snapshot) as Snapshot).amount, 0), pending: orders.filter(o => ['generating', 'awaiting_payment'].includes(o.status)).length, failed: orders.filter(o => o.status === 'failed').length, pages: todays.filter(o => o.paid).reduce((n, o) => { const s: Snapshot = JSON.parse(o.snapshot); return n + s.pages * s.copies; }, 0), recent: orders.slice(0, 6).map(presentOrder) });
  });
  app.get('/api/admin/orders', (req, res) => {
    const search = String(req.query.search || '').slice(0, 100).toLowerCase(), status = String(req.query.status || '');
    const orders = (db.prepare('SELECT * FROM orders ORDER BY created DESC LIMIT 1000').all() as OrderRow[]).filter(o => (!status || o.status === status) && (!search || `${o.code} ${o.snapshot}`.toLowerCase().includes(search)));
    res.json(orders.map(presentOrder));
  });
  app.post('/api/admin/orders/:id/retry', (req, res) => {
    const o = ownedOrder(req, String(req.params.id)); if (o.status !== 'failed' || !o.paid || o.expires <= Date.now()) throw new AppError(409, '仅可重试已支付且未过期的失败订单。');
    const snap: Snapshot = JSON.parse(o.snapshot); makeSnapshot(snap, snap.fileIds.map(id => ownedFile(req, id)), snap.settings);
    db.prepare("UPDATE orders SET status='generating',error=NULL WHERE id=?").run(o.id); event(o.id, '商家重试文件生成'); res.json({ ok: true });
  });
  app.get('/api/admin/settings', (_req, res) => res.json(settings()));
  app.put('/api/admin/settings', async (req, res) => {
    const next = settingsSchema.parse(req.body);
    if (next.accepting && !settings().accepting) await stationReady(true);
    db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(next)); res.json(next);
  });
  app.put('/api/admin/password', (req, res) => {
    const input = z.object({ current: z.string().max(256), next: z.string().min(12).max(128) }).parse(req.body);
    if (!checkPassword(input.current)) throw new AppError(400, '原密码不正确。');
    transaction(() => { db.prepare('UPDATE credentials SET hash=? WHERE id=1').run(hashPassword(input.next)); db.prepare("DELETE FROM sessions WHERE role='admin'").run(); });
    cookie(res, 'merchant', session('admin'), 12); res.json({ ok: true });
  });
  app.get('/api/admin/device', async (_req, res) => {
    const printer = await printers.state();
    const addresses = Object.values(os.networkInterfaces()).flat().filter(i => i && !i.internal && i.family === 'IPv4').map(i => i!.address);
    res.json({ mode: 'artifact', printer, accepting: settings().accepting && printer.ready && onboarding().completed, label: printer.ready ? '默认打印队列已配置 · PDF 测试模式' : '待连接打印机 · 暂停接单', wordReady: !!sofficePath(), fontReady: existsSync(config.font), url: config.publicUrl, addresses, qr: await QRCode.toDataURL(config.publicUrl, { width: 512, margin: 2 }), conversionQueue: Number((db.prepare("SELECT count(*) AS n FROM files WHERE status IN ('queued','processing')").get() as { n: number }).n) });
  });
  app.use('/api', (_req, _res, next) => next(new AppError(404, '接口不存在。')));
  if (existsSync(path.resolve('dist'))) { app.use(express.static(path.resolve('dist'))); app.get('/{*path}', (_req, res) => res.sendFile(path.resolve('dist/index.html'))); }
  app.use((e: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (e instanceof AppError) res.status(e.status).json({ error: e.message });
    else if (e instanceof ZodError) res.status(400).json({ error: '参数有误，请检查填写内容。', fields: e.issues.map(i => i.path.join('.')) });
    else if (e instanceof multer.MulterError) res.status(400).json({ error: e.code === 'LIMIT_FILE_SIZE' ? '单个文件不能超过 30 MB。' : '请每次上传一个文件。' });
    else { console.error('Request failed:', e instanceof Error ? e.message : 'unknown'); res.status(500).json({ error: '服务暂时不可用，请稍后重试。' }); }
  });
  return app;
}
