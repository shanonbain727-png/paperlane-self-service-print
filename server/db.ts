import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { config, prepareDirs } from './config.ts';
import type { Settings } from './types.ts';
prepareDirs();
export const db = new DatabaseSync(path.join(config.data, 'print.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY, role TEXT NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credentials(id INTEGER PRIMARY KEY CHECK(id=1), hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, owner TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL, ext TEXT NOT NULL, status TEXT NOT NULL, pages INTEGER NOT NULL DEFAULT 0, error TEXT, created INTEGER NOT NULL, expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS quotes(id TEXT PRIMARY KEY, owner TEXT NOT NULL, snapshot TEXT NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, owner TEXT NOT NULL, code TEXT UNIQUE NOT NULL, quote_id TEXT UNIQUE NOT NULL, snapshot TEXT NOT NULL, status TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL, expires INTEGER NOT NULL, error TEXT, output_pages INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS payments(order_id TEXT PRIMARY KEY REFERENCES orders(id), reference TEXT UNIQUE NOT NULL, amount INTEGER NOT NULL, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, order_id TEXT, action TEXT NOT NULL, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS files_owner ON files(owner);
CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner);
`);
export const defaults: Settings = { shopName: '纸间自助打印', deviceName: '一号打印站', accepting: true, phone: '', address: '欢迎来到纸间打印站', hours: '全天自助', coverNote: '请核对取件码，带走属于你的那一份。', showName: true, simplexPrice: 20, duplexPrice: 20, retentionHours: 24 };
db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify(defaults));
export function settings(): Settings { return JSON.parse((db.prepare('SELECT value FROM settings WHERE id=1').get() as { value: string }).value); }
export function hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`; }
export function checkPassword(password: string) {
  const row = db.prepare('SELECT hash FROM credentials WHERE id=1').get() as { hash: string } | undefined;
  if (!row) return false;
  const [salt, hash] = row.hash.split(':');
  return timingSafeEqual(Buffer.from(hash, 'hex'), scryptSync(password, salt, 64));
}
if (config.adminPassword.length >= 12) db.prepare('INSERT OR IGNORE INTO credentials VALUES(1,?)').run(hashPassword(config.adminPassword));
export function transaction<T>(fn: () => T): T { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (e) { db.exec('ROLLBACK'); throw e; } }
export function event(orderId: string, action: string) { db.prepare('INSERT INTO events(order_id,action,created) VALUES(?,?,?)').run(orderId, action, Date.now()); }
