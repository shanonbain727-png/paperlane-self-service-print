import { z } from 'zod';
import type { Settings, FileRow, Snapshot } from './types.ts';
export const optionsSchema = z.object({ fileIds: z.array(z.string().uuid()).min(1).max(10).refine(v => new Set(v).size === v.length), copies: z.number().int().min(1).max(20), duplex: z.boolean(), name: z.string().trim().max(30).default('') });
export const settingsSchema = z.object({
  shopName: z.string().trim().min(1).max(40), deviceName: z.string().trim().min(1).max(40), accepting: z.boolean(),
  phone: z.string().trim().max(30), address: z.string().trim().max(100), hours: z.string().trim().max(60),
  coverNote: z.string().trim().max(120), showName: z.boolean(), simplexPrice: z.number().int().min(1).max(10000), duplexPrice: z.number().int().min(1).max(10000), retentionHours: z.number().int().min(1).max(168)
});
export class AppError extends Error { constructor(public status: number, message: string) { super(message); } }
export function makeSnapshot(input: unknown, files: FileRow[], shop: Settings): Snapshot {
  const options = optionsSchema.parse(input);
  if (files.length !== options.fileIds.length || files.some(f => f.status !== 'ready' || f.expires <= Date.now())) throw new AppError(409, '请等待所有文件转换完成，或重新上传已过期文件。');
  if (files.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) throw new AppError(400, '每单文件总大小不能超过 100 MB。');
  const pages = files.reduce((n, f) => n + f.pages, 0);
  if (pages * options.copies > 2000) throw new AppError(400, '每单最多 2000 个正文印刷面，请减少文件或份数。');
  const unitPrice = options.duplex ? shop.duplexPrice : shop.simplexPrice;
  return { ...options, files: files.map(f => ({ id: f.id, name: f.name, pages: f.pages })), pages, unitPrice, amount: pages * options.copies * unitPrice, settings: { ...shop } };
}
