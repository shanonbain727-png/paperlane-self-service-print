import { useEffect, useState, useCallback } from 'react';
import { Printer, ArrowUpRight, LoaderCircle, X, FileText, Check, CircleAlert } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Settings, Snapshot } from '../server/types';
export type Device = Settings & { wordReady: boolean; id: string; printerReady: boolean; unavailableReason: string };
export type FileItem = { id: string; name: string; size: number; ext: string; status: string; pages: number; error: string | null; expires: number };
export type Order = { id: string; code: string; status: string; paid: number; created: number; expires: number; snapshot: Snapshot; outputAvailable: boolean; output_pages: number; error: string | null; events?: { action: string; created: number }[] };
export async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...init?.headers } });
  const body = await response.json(); if (!response.ok) throw new Error(body.error || '请求失败，请重试'); return body;
}
export const post = <T = any,>(url: string, body: unknown = {}) => api<T>(url, { method: 'POST', body: JSON.stringify(body) });
export const money = (n: number) => `¥${(n / 100).toFixed(2)}`;
export const when = (n: number) => new Date(n).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const statusText: Record<string, string> = { awaiting_payment: '待测试支付', generating: '正在生成', ready: '待打印文件已生成', failed: '处理失败', cancelled: '已取消', expired: '文件已过期', queued: '等待转换', processing: '转换中' };
export function useLoad<T>(load: () => Promise<T>, deps: unknown[] = [], poll = 0) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState('');
  const reload = useCallback(async () => { try { setData(await load()); setError(''); } catch (e) { setError((e as Error).message); } }, deps);
  useEffect(() => { let active = true; const run = async () => { try { const result = await load(); if (active) { setData(result); setError(''); } } catch (e) { if (active) setError((e as Error).message); } }; void run(); const t = poll ? setInterval(run, poll) : undefined; return () => { active = false; clearInterval(t); }; }, deps);
  return { data, error, reload };
}
export function Brand({ small = false }: { small?: boolean }) { return <Link className={`brand ${small ? 'small' : ''}`} to="/"><span className="brand-symbol"><Printer size={22}/></span><span>纸间<span className="brand-en">PAPERLANE</span></span></Link>; }
export function Header() { return <header className="customer-header"><Brand/><nav><Link to="/orders">我的订单</Link><Link className="merchant-link" to="/merchant">商家中心 <ArrowUpRight size={14}/></Link></nav></header>; }
export function Footer() { return <footer className="customer-footer"><span>让每一份资料，整整齐齐。</span><span>纸间 PAPERLANE · 自助打印</span></footer>; }
export function Alert({ children, type = 'error' }: { children: React.ReactNode; type?: 'error' | 'info' }) { return <div className={`alert ${type}`} role={type === 'error' ? 'alert' : 'status'}><CircleAlert size={17}/><span>{children}</span></div>; }
export function Badge({ status }: { status: string }) { return <span className={`badge ${status}`}><span/>{statusText[status] || status}</span>; }
export function Loading() { return <div className="loading"><LoaderCircle className="spin" size={22}/> 正在加载</div>; }
export function Empty({ text = '暂时还没有订单', detail = '开始第一份打印，订单会出现在这里。' }: { text?: string; detail?: string }) { return <div className="empty"><span className="empty-icon"><FileText size={32}/></span><h3>{text}</h3><p>{detail}</p></div>; }
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) { useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; document.addEventListener('keydown', onKey); return () => document.removeEventListener('keydown', onKey); }, [onClose]); return <div className="modal-backdrop" onClick={onClose}><section className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={e => e.stopPropagation()}><div className="modal-head"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X/></button></div>{children}</section></div>; }
export function Saved({ text }: { text: string }) { return text ? <div className="saved" role="status"><Check size={16}/>{text}</div> : null; }
