import { useState } from 'react';
import { Printer, RefreshCw, Cable, Network, Server, Check } from 'lucide-react';
import { api, Alert, Saved } from './lib';
import type { PrinterState } from '../server/printers';

export function PrinterConnection({ state, onChange }: { state?: PrinterState; onChange: () => Promise<void> }) {
  const [inventory, setInventory] = useState<PrinterState | null>(null);
  const [selected, setSelected] = useState(''), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [saved, setSaved] = useState('');
  const [method, setMethod] = useState('usb');
  async function connect() {
    setBusy(true); setError(''); setSaved('');
    try {
      const result = await api<PrinterState>('/api/admin/printers');
      setInventory(result); setSelected(result.defaultPrinter?.name || ''); await onChange();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function save() {
    setBusy(true); setError(''); setSaved('');
    try {
      const result = await api<PrinterState>('/api/admin/printers/default', { method: 'PUT', body: JSON.stringify({ name: selected }) });
      setInventory(result); await onChange();
      setSaved('默认打印机已保存，重启服务后仍然有效。');
    } catch (e) { setError((e as Error).message); await onChange(); } finally { setBusy(false); }
  }
  async function disconnect() {
    setBusy(true); setError(''); setSaved('');
    try { const result = await api<PrinterState>('/api/admin/printers/default', { method: 'DELETE' }); setInventory(result); setSelected(''); await onChange(); setSaved('默认打印机已解除，已暂停新订单。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="panel printer-connection">
    <div className="section-heading"><div><span className="eyebrow">CONNECT YOUR PRINTER</span><h2><Printer size={21}/>连接打印机</h2></div><button className="primary" onClick={connect} disabled={busy}>{busy ? <RefreshCw className="spin" size={16}/> : <RefreshCw size={16}/>} {busy ? '正在检测…' : inventory ? '重新检测' : '连接打印机'}</button></div>
    <p className="form-desc">读取运行服务的电脑上已安装的全部打印机，选择一台作为本站默认打印机。</p>
    <div className="connection-methods" role="group" aria-label="打印机连接方案">
      {[{ id: 'usb', icon: Cable, label: 'USB 直连' }, { id: 'network', icon: Network, label: '网络 / 共享' }, { id: 'cups', icon: Server, label: 'Linux / CUPS' }].map(({ id, icon: Icon, label }) => <button key={id} className={method === id ? 'selected' : ''} aria-pressed={method === id} onClick={() => setMethod(id)}><Icon size={18}/>{label}</button>)}
    </div>
    <p className="connection-help">{method === 'usb' ? '用 USB 将打印机接到运行服务的电脑，安装厂商驱动，在系统中打印测试页，再点击「连接打印机」。' : method === 'network' ? '打印机与运行服务的电脑连接同一网络，先在系统中通过 IP 地址、IPP 或共享名称添加打印机，再点击「连接打印机」。' : '在运行服务的 Linux 电脑安装并启动 CUPS，通过系统打印设置添加队列；确认服务运行账户执行 lpstat -p 可以列出打印机，再点击「连接打印机」。'}</p>
    <div className="printer-default"><Printer size={24}/><div><small>本站默认打印机</small><strong>{state?.defaultPrinter?.name || '尚未选择'}</strong><span>{state?.ready ? '系统队列可用 · 允许开启测试接单' : state?.reason || '正在检查配置…'}</span></div>{state?.defaultPrinter && <button className="text-button" disabled={busy} onClick={disconnect}>解除默认</button>}</div>
    {inventory && <div className="printer-inventory">
      <div className="printer-inventory-heading"><strong>检测到 {inventory.printers.length} 台打印机</strong><span>{inventory.backend === 'windows' ? 'Windows' : 'CUPS'} · {inventory.host}</span></div>
      {inventory.error ? <Alert>{inventory.error}</Alert> : inventory.printers.length === 0 ? <Alert type="info">没有检测到已安装的打印机，请按上面的连接方案添加打印机后重新检测。</Alert> : <fieldset className="printer-options" disabled={busy}><legend className="sr-only">选择默认打印机</legend>{inventory.printers.map(p => <label key={p.name} className={`printer-option ${selected === p.name ? 'selected' : ''}`}><input type="radio" name="default-printer" value={p.name} checked={selected === p.name} disabled={!p.available} onChange={() => { setSelected(p.name); setSaved(''); }}/><div className="printer-option-main"><strong>{p.name}</strong><span>{p.driver || '系统打印机'} · {p.connection}</span><small className={p.available ? 'green' : 'amber'}>{p.status}{p.virtual ? ' · 仅供测试，不会出纸' : ''}</small></div><div className="printer-tags">{p.systemDefault && <span>系统默认</span>}{state?.defaultPrinter?.name === p.name && state.defaultPrinter.host === inventory.host && <span className="green"><Check size={12}/>本站默认</span>}</div></label>)}</fieldset>}
      <div className="form-footer"><span className="hint">只保存本站默认，不修改操作系统默认打印机。</span><button className="primary" disabled={busy || !!inventory.error || !inventory.printers.some(p => p.name === selected && p.available)} onClick={save}>设为默认打印机</button></div>
    </div>}
    {error && <Alert>{error}</Alert>}<Saved text={saved}/>
    <p className="hint connection-limit">列表来自服务器电脑，不是浏览器所在电脑。云端部署需另接店内打印执行端。当前版本仍生成 PDF，选择队列后也不会自动出纸；系统队列状态不代表实体设备已通过出纸验收。</p>
  </section>;
}
