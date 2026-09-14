import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import request from 'supertest';
import type { PrinterQueue, PrinterInventory } from '../server/printers';

process.env.DATA_DIR = path.resolve('test-results', `printers-${randomUUID()}`);
process.env.ADMIN_PASSWORD = 'Printer-Integration-Test-Password';
const { createApp } = await import('../server/app.ts');
const { PrinterService, parseWindowsPrinters, parseCupsPrinters } = await import('../server/printers.ts');
const { db, settings } = await import('../server/db.ts');
const { tick } = await import('../server/worker.ts');
const queue: PrinterQueue = { name: '佳能 测试队列 $(); 中文', driver: 'Test driver', connection: 'USB', status: '可用', available: true, virtual: false, systemDefault: false };
let inventory: PrinterInventory = { backend: 'windows', printers: [queue] }, fail = false;
const discover = async () => { if (fail) throw new Error('access denied'); return inventory; };
const service = new PrinterService(discover, 'test-host'), app = createApp(service);
const admin = request.agent(app), guest = request.agent(app);
before(async () => { await admin.post('/api/admin/login').send({ password: process.env.ADMIN_PASSWORD }).expect(200); });
after(() => db.close());

test('unconfigured station stays accessible but blocks orders and protects printer settings', async () => {
  const state = (await guest.get('/api/device').expect(200)).body;
  assert.equal(state.accepting, false); assert.equal(state.printerReady, false); assert.match(state.unavailableReason, /默认打印机/);
  assert.equal(state.printers, undefined); assert.equal(state.host, undefined);
  await guest.get('/api/admin/printers').expect(401);
  await guest.put('/api/admin/printers/default').send({ name: queue.name }).expect(401);
  await guest.delete('/api/admin/printers/default').expect(401);
  await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(409);
  await guest.post('/api/quotes').send({ fileIds: [], copies: 1, duplex: false }).expect(409);
  assert.equal(db.prepare('SELECT count(*) AS n FROM files').get()!.n, 0);
  await admin.put('/api/admin/settings').send({ ...settings(), accepting: false }).expect(200);
  await admin.put('/api/admin/settings').send({ ...settings(), accepting: true }).expect(409);
});

test('scan lists all queues without automatically binding; exact selection persists across service restart', async () => {
  const scanned = (await admin.get('/api/admin/printers').expect(200)).body;
  assert.equal(scanned.printers[0].name, queue.name); assert.equal(scanned.defaultPrinter, null);
  await admin.put('/api/admin/printers/default').send({ name: 'invented printer' }).expect(409);
  const saved = (await admin.put('/api/admin/printers/default').send({ name: queue.name }).expect(200)).body;
  assert.equal(saved.ready, true); assert.equal(saved.defaultPrinter.name, queue.name);
  const restarted = await new PrinterService(discover, 'test-host').state();
  assert.equal(restarted.ready, true); assert.equal(restarted.defaultPrinter?.name, queue.name);
  const relocated = await new PrinterService(discover, 'other-host').state();
  assert.equal(relocated.ready, false); assert.match(relocated.reason, /更换电脑/);
  await admin.put('/api/admin/settings').send({ ...settings(), accepting: true }).expect(200);
  assert.equal((await guest.get('/api/device')).body.accepting, true);
});

test('offline, removed and inaccessible queues fail closed while retaining the configured name', async () => {
  inventory = { backend: 'windows', printers: [{ ...queue, available: false }] };
  assert.equal((await admin.get('/api/admin/printers')).body.ready, false);
  await admin.put('/api/admin/printers/default').send({ name: queue.name }).expect(409);
  assert.equal((await guest.get('/api/device')).body.accepting, false);
  inventory = { backend: 'windows', printers: [] };
  assert.match((await admin.get('/api/admin/printers')).body.reason, /已移除/);
  fail = true;
  const unavailable = (await admin.get('/api/admin/printers')).body;
  assert.ok(unavailable.error); assert.deepEqual(unavailable.printers, []); assert.equal(unavailable.ready, false);
  assert.equal(unavailable.defaultPrinter.name, queue.name);
  await admin.put('/api/admin/printers/default').send({ name: queue.name }).expect(503);
  await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(409);
  fail = false; inventory = { backend: 'windows', printers: [queue] };
  assert.equal((await admin.get('/api/admin/printers')).body.ready, true);
});

test('disconnect blocks existing quotes and legacy payment; checkout rechecks OS and stays idempotent under concurrency', async () => {
  const uploaded = await guest.post('/api/files').attach('file', 'examples/sample-photo.png').expect(201); await tick();
  const options = { fileIds: [uploaded.body.id], copies: 1, duplex: false };
  const quote = (await guest.post('/api/quotes').send(options).expect(200)).body;
  // No admin refresh: checkout itself must detect that the queue disappeared.
  inventory = { backend: 'windows', printers: [] };
  await guest.post('/api/orders').send({ quoteId: quote.id }).expect(409);
  inventory = { backend: 'windows', printers: [queue] };
  const concurrent = await Promise.all([guest.post('/api/orders').send({ quoteId: quote.id }), guest.post('/api/orders').send({ quoteId: quote.id })]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 201]);
  assert.equal(concurrent[0].body.id, concurrent[1].body.id);
  assert.equal(db.prepare('SELECT count(*) AS n FROM payments').get()!.n, 1);
  const id = concurrent[0].body.id;
  db.prepare('DELETE FROM payments WHERE order_id=?').run(id);
  db.prepare("UPDATE orders SET paid=0,status='awaiting_payment' WHERE id=?").run(id);
  const pending = (await guest.post('/api/quotes').send(options).expect(200)).body;
  await admin.delete('/api/admin/printers/default').expect(200);
  await guest.post('/api/orders').send({ quoteId: pending.id }).expect(409);
  await guest.post(`/api/orders/${id}/pay`).expect(409);
  await guest.get(`/api/orders/${id}`).expect(200);
  assert.equal((await new PrinterService(discover, 'test-host').state()).defaultPrinter, null);
});

test('Windows parser handles Unicode, virtual and physical connections, faults and single-queue output', () => {
  const rows = parseWindowsPrinters(JSON.stringify([
    { Name: '佳能', DriverName: 'Canon', PortName: 'USB001', Status: 'Normal' },
    { Name: '小米', PortName: 'IP_192.168.1.20', Status: 'Offline' },
    { Name: 'Microsoft Print to PDF', PortName: 'PORTPROMPT:', Status: 'Normal', Default: true },
    { Name: 'Shared', PortName: 'LPT1', Type: 1, WorkOffline: true },
  ]));
  assert.equal(rows.length, 4); assert.equal(rows[0].connection, 'USB'); assert.equal(rows[0].virtual, false);
  assert.equal(rows[1].connection, '网络 / 共享'); assert.equal(rows[1].available, false);
  assert.equal(rows[2].virtual, true); assert.equal(rows[2].systemDefault, true); assert.equal(rows[3].available, false);
  assert.equal(parseWindowsPrinters('{"Name":"only"}').length, 1); assert.deepEqual(parseWindowsPrinters('[]'), []);
  assert.throws(() => parseWindowsPrinters('invalid'));
});

test('CUPS parser handles enabled, disabled, network, USB and virtual queues', () => {
  const rows = parseCupsPrinters('printer canon is idle. enabled since Mon\nprinter office disabled since Mon -\nprinter PDF is idle. enabled since Mon\n', 'system default destination: canon', 'device for canon: usb://Canon/test\ndevice for office: ipp://user:secret@host/printer\ndevice for PDF: cups-pdf:/');
  assert.equal(rows.length, 3); assert.equal(rows[0].systemDefault, true); assert.equal(rows[0].connection, 'USB');
  assert.equal(rows[1].available, false); assert.equal(rows[1].connection, '网络 / 共享'); assert.equal(rows[2].virtual, true);
  assert.ok(!JSON.stringify(rows).includes('secret')); assert.deepEqual(parseCupsPrinters('', '', ''), []);
});
