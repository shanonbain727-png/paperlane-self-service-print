import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
async function pdfText(file: string) { const task = getDocument({ data: new Uint8Array(await readFile(file)) }); const doc = await task.promise; const text: string[] = []; for (let i=1;i<=doc.numPages;i++) { const content = await (await doc.getPage(i)).getTextContent(); text.push(content.items.filter(i => 'str' in i).map(i => i.str).join(' ')); } await task.destroy(); return text; }
import { createFixtures } from '../scripts/fixtures.ts';
process.env.DATA_DIR = path.resolve('test-results', `api-${randomUUID()}`);
process.env.ADMIN_PASSWORD = 'Integration-Test-Only-Password-2026';
process.env.PAYMENT_MODE = 'mock';
const { createApp } = await import('../server/app.ts');
const { db, settings } = await import('../server/db.ts');
const { tick, recover, cleanup } = await import('../server/worker.ts');
const { filePath, sofficePath } = await import('../server/config.ts');
const { makeSnapshot } = await import('../server/domain.ts');
const app = createApp(), guest = request.agent(app), other = request.agent(app), admin = request.agent(app);
let fileId = '', orderId = '', wordId = '', photoId = '';
before(async () => { await createFixtures('examples'); await guest.get('/api/device').expect(200); await other.get('/api/device').expect(200); await admin.post('/api/admin/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200); });
after(async () => { await writeFile(path.join(process.env.DATA_DIR!, 'summary.json'), JSON.stringify({ orderId, fileId, wordId, photoId, output: filePath(orderId, 'output'), wordPdf: filePath(wordId, 'converted') }, null, 2)); db.close(); });
test('merchant endpoints require authentication and reject cross-site writes', async () => {
  await other.get('/api/admin/orders').expect(401);
  await guest.post('/api/quotes').set('Origin', 'https://attacker.example').send({}).expect(403);
  const res = await admin.get('/api/admin/device').expect(200); assert.equal(res.body.mode, 'artifact'); assert.ok(res.body.fontReady); assert.ok(res.body.qr.startsWith('data:image/png'));
});
test('upload real three-page mixed orientation PDF and normalize to A4', async () => {
  const res = await guest.post('/api/files').attach('file', 'examples/three-pages.pdf').expect(201); fileId = res.body.id;
  await tick(); const files = await guest.get('/api/files'); const file = files.body.find((f: any) => f.id === fileId); assert.equal(file.status, 'ready'); assert.equal(file.pages, 3);
  const pdf = await PDFDocument.load(await readFile(filePath(fileId, 'converted'))); assert.equal(pdf.getPageCount(), 3);
  assert.ok(Math.abs(pdf.getPage(0).getWidth() - 595.28) < .1); assert.ok(pdf.getPage(1).getWidth() > pdf.getPage(1).getHeight()); assert.ok(pdf.getPage(2).getWidth() > pdf.getPage(2).getHeight());
  await guest.get(`/api/files/${fileId}/pdf`).expect(200); await other.get(`/api/files/${fileId}/pdf`).expect(404);
});
test('real Word conversion: Chinese, table and picture, two pages', async () => {
  assert.ok(sofficePath(), 'Word acceptance requires a real LibreOffice installation');
  const res = await guest.post('/api/files').attach('file', 'examples/sample-document.docx').expect(201); wordId = res.body.id;
  await tick(); const f = db.prepare('SELECT * FROM files WHERE id=?').get(wordId)!; assert.equal(f.status, 'ready', String(f.error)); assert.equal(f.pages, 2); const text = await pdfText(filePath(wordId, 'converted')); assert.match(text[0], /学习资料/); assert.match(text[0], /项目/); assert.match(text[1], /WORD-PAGE-2/);
});
test('image normalization respects EXIF orientation', async () => {
  const res = await guest.post('/api/files').attach('file', 'examples/rotated-photo.jpg').expect(201); photoId = res.body.id; await tick();
  const pdf = await PDFDocument.load(await readFile(filePath(photoId, 'converted'))); assert.equal(pdf.getPageCount(), 1); assert.ok(pdf.getPage(0).getHeight() > pdf.getPage(0).getWidth());
});
test('legacy DOC uses the real conversion pipeline', async () => {
  const res = await guest.post('/api/files').attach('file', 'examples/sample-document.doc').expect(201);
  await tick(); const f = db.prepare('SELECT * FROM files WHERE id=?').get(res.body.id)!;
  assert.equal(f.status, 'ready', String(f.error)); assert.equal(f.pages, 2);
  const text = await pdfText(filePath(res.body.id, 'converted')); assert.match(text[0], /学习资料/); assert.match(text[1], /WORD-PAGE-2/);
});
test('password-protected PDFs fail clearly and cannot be quoted', async () => {
  const res = await guest.post('/api/files').attach('file', 'examples/password-protected.pdf').expect(201);
  await tick(); const f = db.prepare('SELECT * FROM files WHERE id=?').get(res.body.id)!;
  assert.equal(f.status, 'failed'); assert.match(String(f.error), /加密/);
  await guest.post('/api/quotes').send({ fileIds: [res.body.id], copies: 1, duplex: false }).expect(409);
});
test('quote price is server-derived, immutable and reusable for order idempotency', async () => {
  const q = await guest.post('/api/quotes').send({ fileIds: [fileId], copies: 2, duplex: true, name: '陈同学', amount: 1 }).expect(200); assert.equal(q.body.amount, 120);
  await admin.put('/api/admin/settings').send({ ...settings(), duplexPrice: 35 }).expect(200);
  const created = await guest.post('/api/orders').send({ quoteId: q.body.id }).expect(201); orderId = created.body.id;
  assert.equal(created.body.snapshot.amount, 120); assert.equal(created.body.snapshot.unitPrice, 20);
  const again = await guest.post('/api/orders').send({ quoteId: q.body.id }).expect(200); assert.equal(again.body.id, orderId);
  await other.get(`/api/orders/${orderId}`).expect(404);
});
test('duplicate mock payments create one payment, output has one cover and correct duplex gaps', async () => {
  await guest.get(`/api/orders/${orderId}/pdf`).expect(410);
  const results = await Promise.all([guest.post(`/api/orders/${orderId}/pay`), guest.post(`/api/orders/${orderId}/pay`)]); assert.ok(results.every(r => r.status === 200));
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments WHERE order_id=?').get(orderId)!.n, 1);
  recover(); await tick();
  const res = await guest.get(`/api/orders/${orderId}`).expect(200); assert.equal(res.body.status, 'ready'); assert.equal(res.body.output_pages, 10); assert.ok(res.body.outputAvailable);
  const pdf = await PDFDocument.load(await readFile(filePath(orderId, 'output'))); assert.equal(pdf.getPageCount(), 10);
  for (const n of [1,5,9]) assert.equal(pdf.getPage(n).node.Contents(), undefined, `page ${n + 1} should be blank`);
  const outputText = await pdfText(filePath(orderId, 'output')); assert.match(outputText[0], /陈同学/); assert.match(outputText[0], /取件码/); assert.match(outputText[2], /PAGE-1/); assert.match(outputText[6], /PAGE-1/);
  await guest.get(`/api/orders/${orderId}/pdf`).expect(200); await other.get(`/api/orders/${orderId}/pdf`).expect(404); await admin.get(`/api/orders/${orderId}/pdf`).expect(200);
  await guest.post(`/api/orders/${orderId}/pay`).expect(200); await tick(); assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get()!.n, 1);
  await guest.delete(`/api/files/${fileId}`).expect(409);
});
test('merchant metrics, order search, cover and store settings persist', async () => {
  const stats = await admin.get('/api/admin/overview').expect(200); assert.equal(stats.body.amount, 120); assert.equal(stats.body.today, 1); assert.equal(stats.body.pages, 6);
  const code = (await admin.get(`/api/orders/${orderId}`)).body.code; const filtered = await admin.get(`/api/admin/orders?search=${code}&status=ready`).expect(200); assert.equal(filtered.body.length, 1);
  await admin.put('/api/admin/settings').send({ ...settings(), shopName: '测试打印店', coverNote: '请核对你的资料', showName: false, phone: '测试客服', retentionHours: 12 }).expect(200);
  assert.equal((await guest.get('/api/device')).body.shopName, '测试打印店');
});
test('paused device rejects upload, quotes and unpaid checkout; cancellation prevents payment', async () => {
  const q = await guest.post('/api/quotes').send({ fileIds: [fileId], copies: 1, duplex: false, name: '' }).expect(200);
  const o = await guest.post('/api/orders').send({ quoteId: q.body.id }).expect(201);
  await admin.put('/api/admin/settings').send({ ...settings(), accepting: false }).expect(200);
  await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(409);
  await guest.post('/api/quotes').send({ fileIds: [fileId], copies: 1, duplex: false }).expect(409);
  await guest.post(`/api/orders/${o.body.id}/pay`).expect(409);
  await guest.post(`/api/orders/${o.body.id}/cancel`).expect(200);
  await admin.put('/api/admin/settings').send({ ...settings(), accepting: true }).expect(200);
  await guest.post(`/api/orders/${o.body.id}/pay`).expect(409);
});
test('corrupt, mislabeled, oversized and unowned files cannot be ordered', async () => {
  await guest.post('/api/files').attach('file', Buffer.from('not a pdf'), 'bad.pdf').expect(400);
  await guest.post('/api/files').attach('file', Buffer.alloc(30 * 1024 * 1024 + 1), 'large.pdf').expect(400);
  const bad = await guest.post('/api/files').attach('file', Buffer.from('%PDF-1.7\ncorrupt'), 'corrupt.pdf').expect(201); await tick();
  assert.equal(db.prepare('SELECT status FROM files WHERE id=?').get(bad.body.id)!.status, 'failed');
  await guest.post('/api/quotes').send({ fileIds: [bad.body.id], copies: 1, duplex: false }).expect(409);
  await other.post('/api/quotes').send({ fileIds: [fileId], copies: 1, duplex: false }).expect(404);
  await guest.post('/api/quotes').send({ fileIds: [fileId, fileId], copies: 1, duplex: false }).expect(400);
  await guest.post('/api/quotes').send({ fileIds: [fileId], copies: 21, duplex: false }).expect(400);
  await guest.post(`/api/files/${bad.body.id}/retry`).expect(200); await tick(); await guest.delete(`/api/files/${bad.body.id}`).expect(200);
});
test('100 MB order limit and printed-side cap are checked by the server', () => {
  const f = db.prepare('SELECT * FROM files WHERE id=?').get(fileId) as any;
  assert.throws(() => makeSnapshot({ fileIds: [fileId], copies: 1, duplex: false }, [{ ...f, size: 101 * 1024 * 1024 }], settings()));
  assert.throws(() => makeSnapshot({ fileIds: [fileId], copies: 20, duplex: false }, [{ ...f, pages: 101 }], settings()));
});
test('multi-file single-sided output and merchant retry recover a failed order', async () => {
  const q = await guest.post('/api/quotes').send({ fileIds: [wordId, photoId], copies: 2, duplex: false, name: '李同学' }).expect(200); assert.equal(q.body.pages, 3);
  const o = await guest.post('/api/orders').send({ quoteId: q.body.id }).expect(201); await guest.post(`/api/orders/${o.body.id}/pay`).expect(200);
  db.prepare("UPDATE orders SET status='failed',error='Injected test failure' WHERE id=?").run(o.body.id);
  await other.post(`/api/admin/orders/${o.body.id}/retry`).expect(401); await admin.post(`/api/admin/orders/${o.body.id}/retry`).expect(200); await tick();
  const pdf = await PDFDocument.load(await readFile(filePath(o.body.id, 'output'))); assert.equal(pdf.getPageCount(), 7);
});
test('startup recovery returns interrupted conversions to the queue', async () => {
  const uploaded = await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(201);
  db.prepare("UPDATE files SET status='processing' WHERE id=?").run(uploaded.body.id); recover(); assert.equal(db.prepare('SELECT status FROM files WHERE id=?').get(uploaded.body.id)!.status, 'queued'); await tick(); assert.equal(db.prepare('SELECT status FROM files WHERE id=?').get(uploaded.body.id)!.status, 'ready');
});
test('password update invalidates other merchant sessions', async () => {
  const second = request.agent(app); await second.post('/api/admin/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200);
  await admin.put('/api/admin/password').send({ current: process.env.ADMIN_PASSWORD, next: 'Updated-Test-Only-Password-2026' }).expect(200);
  await second.get('/api/admin/orders').expect(401); await admin.get('/api/admin/orders').expect(200);
});
test('expiration removes physical files and blocks download and retry, retaining order summary', async () => {
  const uploaded = await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(201); await tick();
  const q = await guest.post('/api/quotes').send({ fileIds: [uploaded.body.id], copies: 1, duplex: false }).expect(200);
  const o = await guest.post('/api/orders').send({ quoteId: q.body.id }).expect(201); await guest.post(`/api/orders/${o.body.id}/pay`).expect(200); await tick();
  db.prepare('UPDATE files SET expires=1 WHERE id=?').run(uploaded.body.id); db.prepare('UPDATE orders SET expires=1 WHERE id=?').run(o.body.id); await cleanup();
  assert.equal(db.prepare('SELECT status FROM files WHERE id=?').get(uploaded.body.id)!.status, 'expired');
  await assert.rejects(readFile(filePath(uploaded.body.id, 'original', 'png'))); await assert.rejects(readFile(filePath(o.body.id, 'output')));
  await guest.get(`/api/orders/${o.body.id}/pdf`).expect(410); await admin.post(`/api/admin/orders/${o.body.id}/retry`).expect(409);
  assert.equal((await guest.get(`/api/orders/${o.body.id}`)).body.status, 'expired');
});
