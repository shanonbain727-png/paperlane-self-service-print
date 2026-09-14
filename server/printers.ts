import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { db } from './db.ts';
import { AppError } from './domain.ts';

export type PrinterQueue = {
  name: string; driver: string; connection: string; status: string;
  available: boolean; virtual: boolean; systemDefault: boolean;
};
export type PrinterInventory = { backend: 'windows' | 'cups'; printers: PrinterQueue[] };
export type PrinterBinding = { name: string; backend: string; host: string };
export type PrinterState = {
  host: string; backend: string; printers: PrinterQueue[]; defaultPrinter: PrinterBinding | null;
  ready: boolean; reason: string; error: string; scannedAt: number | null;
};
const exec = promisify(execFile);
const isVirtual = (text: string) => /pdf|xps|fax|onenote|虚拟|传真/i.test(text);

export function parseWindowsPrinters(stdout: string): PrinterQueue[] {
  const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim() || '[]');
  return (Array.isArray(value) ? value : [value]).map((p: Record<string, unknown>) => {
    if (typeof p.Name !== 'string' || !p.Name) throw new Error('Invalid printer inventory');
    const driver = String(p.DriverName || ''), port = String(p.PortName || '');
    const status = String(p.Status || 'Unknown');
    const blocked = p.WorkOffline === true || /offline|error|paused|notavailable|paperout|paperjam|tonerlow|no.?toner|dooropen|outofmemory|userintervention/i.test(status) || [4, 5, 6, 7, 8, 9, 11].includes(Number(p.DetectedErrorState));
    const virtual = isVirtual(`${p.Name} ${driver} ${port}`);
    return { name: p.Name, driver, virtual, systemDefault: p.Default === true, available: !blocked,
      connection: virtual ? '虚拟打印机' : /usb/i.test(port) ? 'USB' : /ip_|tcp|wsd|\\\\|ipp|http/i.test(port) || Number(p.Type) === 1 ? '网络 / 共享' : '系统端口',
      status: blocked ? '离线、暂停或故障' : '系统队列可用' };
  });
}

export function parseCupsPrinters(queues: string, defaultOutput: string, ports: string): PrinterQueue[] {
  const defaultName = defaultOutput.match(/system default destination:\s*(.+)/)?.[1]?.trim();
  return queues.split(/\r?\n/).flatMap(line => {
    const match = line.match(/^printer\s+(\S+)\s+(.+)$/); if (!match) return [];
    const [, name, description] = match;
    const uri = ports.split(/\r?\n/).find(p => p.startsWith(`device for ${name}: `))?.slice(`device for ${name}: `.length) || '';
    const virtual = isVirtual(`${name} ${uri}`), available = !/disabled|offline|not connected/i.test(description);
    return [{ name, driver: 'CUPS 系统队列', virtual, systemDefault: name === defaultName, available,
      connection: virtual ? '虚拟打印机' : uri.startsWith('usb:') ? 'USB' : /^(ipp|ipps|socket|lpd|smb|dnssd|http):/.test(uri) ? '网络 / 共享' : '系统端口',
      status: available ? '系统队列已启用' : '队列已停用或离线' }];
  });
}

export async function discoverPrinters(): Promise<PrinterInventory> {
  const options = { timeout: 12000, maxBuffer: 1024 * 1024, windowsHide: true, encoding: 'utf8' as const };
  if (process.platform === 'win32') {
    // Fixed script only. Queue names are never interpolated into shell commands.
    const script = `$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new();
      $details=@{}; try { Get-CimInstance Win32_Printer | ForEach-Object { $details[$_.Name]=$_ } } catch {}
      $result=@(Get-Printer | ForEach-Object { $d=$details[$_.Name]; [pscustomobject]@{Name=$_.Name;DriverName=$_.DriverName;PortName=$_.PortName;Status=$_.PrinterStatus.ToString();Type=[int]$_.Type;Default=($d.Default -eq $true);WorkOffline=($d.WorkOffline -eq $true);DetectedErrorState=$d.DetectedErrorState} });
      ConvertTo-Json -InputObject $result -Compress`;
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], options);
    return { backend: 'windows', printers: parseWindowsPrinters(stdout) };
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw new Error('Unsupported OS');
  const run = async (args: string[], allowEmpty = false) => {
    try { return (await exec('lpstat', args, { ...options, env: { ...process.env, LC_ALL: 'C', LANG: 'C' } })).stdout; }
    catch (e) {
      const output = String((e as { stderr?: string }).stderr || '') + String((e as { stdout?: string }).stdout || '');
      if (allowEmpty && /No destinations added|No printers|no system default destination/i.test(output)) return '';
      throw e;
    }
  };
  if (!/scheduler is running/.test(await run(['-r']))) throw new Error('CUPS is stopped');
  const results = await Promise.allSettled([run(['-p'], true), run(['-d'], true), run(['-v'], true)]);
  const [queues, defaultOutput, ports] = results.map(r => { if (r.status === 'rejected') throw r.reason; return r.value; });
  return { backend: 'cups', printers: parseCupsPrinters(queues, defaultOutput, ports) };
}

export class PrinterService {
  private cache: { inventory: PrinterInventory; error: string; at: number } | null = null;
  private pending: Promise<void> | null = null;
  constructor(private discover: () => Promise<PrinterInventory> = discoverPrinters, readonly host = os.hostname()) {}
  private binding(): PrinterBinding | null {
    const row = db.prepare('SELECT value FROM printer_binding WHERE id=1').get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  async state(force = false): Promise<PrinterState> {
    if (force || this.binding() || this.cache) {
      if (this.pending) await this.pending;
      else if (force || !this.cache || Date.now() - this.cache.at > 15000) {
        this.pending = (async () => {
          try { this.cache = { inventory: await this.discover(), error: '', at: Date.now() }; }
          catch { this.cache = { inventory: { backend: process.platform === 'win32' ? 'windows' : 'cups', printers: [] }, at: Date.now(), error: '读取打印机失败，请检查服务运行账户权限、Windows 打印后台处理程序或 CUPS 服务，然后重新检测。' }; }
        })();
        try { await this.pending; } finally { this.pending = null; }
      }
    }
    // Read the binding after discovery so disconnecting during a scan takes effect.
    const binding = this.binding(), inventory = this.cache?.inventory;
    const printer = inventory?.printers.find(p => p.name === binding?.name);
    const error = this.cache?.error || '';
    const reason = !binding ? '商家尚未选择默认打印机，请先在设备管理中完成连接。'
      : binding.host !== this.host ? '服务已更换电脑，请重新选择默认打印机。'
      : error ? error : !printer || binding.backend !== inventory?.backend ? '默认打印机已移除，请重新连接或选择其他打印机。'
      : !printer.available ? '默认打印机离线、暂停或故障，请检查设备后重新检测。' : '';
    return { host: this.host, backend: inventory?.backend || (process.platform === 'win32' ? 'windows' : 'cups'), printers: inventory?.printers || [], defaultPrinter: binding, ready: !reason, reason, error, scannedAt: this.cache?.at || null };
  }
  async select(name: string) {
    const state = await this.state(true);
    if (state.error) throw new AppError(503, state.error);
    const printer = state.printers.find(p => p.name === name);
    if (!printer) throw new AppError(409, '打印机不存在，请重新检测并选择。');
    if (!printer.available) throw new AppError(409, '该打印机离线、暂停或故障，暂时不能设为默认。');
    db.prepare('INSERT INTO printer_binding VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify({ name, backend: state.backend, host: this.host }));
    return this.state();
  }
  disconnect() { db.prepare('DELETE FROM printer_binding WHERE id=1').run(); }
  async requireReady(force = false) { const state = await this.state(force); if (!state.ready) throw new AppError(409, state.reason); }
}
