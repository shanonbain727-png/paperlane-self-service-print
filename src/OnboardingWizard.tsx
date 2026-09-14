import { useState } from 'react';
import { ArrowLeft, ArrowRight, Check } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api, Alert, Brand, Loading, money, post, useLoad } from './lib';
import { PrinterConnection } from './PrinterConnection';
import type { Settings } from '../server/types';
import type { PrinterState } from '../server/printers';

type Setup = { step: number; completed: boolean; settings: Settings; printer: PrinterState };
export function OnboardingWizard({ onComplete }: { onComplete: () => Promise<void> }) {
  const { data, error, reload } = useLoad(() => api<Setup>('/api/admin/onboarding'));
  return <div className="onboarding-shell"><header><Brand/><span>首次使用 · 打印站初始化</span></header>{error ? <><Alert>{error}</Alert><button className="secondary" onClick={reload}>重新加载</button></> : data ? <Wizard initial={data} onComplete={onComplete}/> : <Loading/>}</div>;
}
function Wizard({ initial, onComplete }: { initial: Setup; onComplete: () => Promise<void> }) {
  const navigate = useNavigate();
  const [data, setData] = useState(initial), [step, setStep] = useState(initial.step);
  const [name, setName] = useState(initial.settings.shopName), [deviceName, setDeviceName] = useState(initial.settings.deviceName), [address, setAddress] = useState(initial.settings.address);
  const [simplex, setSimplex] = useState((initial.settings.simplexPrice / 100).toFixed(2)), [duplex, setDuplex] = useState((initial.settings.duplexPrice / 100).toFixed(2));
  const [accepting, setAccepting] = useState(initial.settings.accepting), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const titles = ['店铺名称', '连接打印机', '打印价格', '确认完成'];
  async function refreshPrinter() { const next = await api<Setup>('/api/admin/onboarding'); setData(next); }
  async function next(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      const body = step === 0 ? { action: 'identity', shopName: name, deviceName, address }
        : step === 1 ? { action: 'printer' }
        : step === 2 ? { action: 'pricing', simplexPrice: Math.round(Number(simplex) * 100), duplexPrice: Math.round(Number(duplex) * 100) }
        : { action: 'complete', accepting };
      const result = await api<Setup>('/api/admin/onboarding', { method: 'PUT', body: JSON.stringify(body) });
      setData(result);
      if (result.completed) { await onComplete(); navigate('/merchant', { replace: true }); }
      else setStep(step + 1);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <main className="onboarding-main">
    <div className="onboarding-heading"><span className="eyebrow">WELCOME TO PAPERLANE</span><h1>先把你的打印站配置好</h1><p>按顺序完成主要设置。每一步保存后，关闭页面也能继续。</p></div>
    <ol className="onboarding-progress" aria-label="首次设置步骤">{titles.map((title, i) => <li key={title} aria-current={step === i ? 'step' : undefined} className={step === i ? 'current' : step > i ? 'done' : ''}><span>{step > i ? <Check size={17}/> : i + 1}</span><strong>{title}</strong></li>)}</ol>
    <section className="panel onboarding-card"><div className="onboarding-step-heading"><span>第 {step + 1} 步，共 4 步</span><h2>{titles[step]}</h2></div>
      {step === 1 && <PrinterConnection state={data.printer} onChange={refreshPrinter}/>}
      <form className="merchant-form" onSubmit={next}>
        {step === 0 && <><p className="form-desc">这些名称会显示在顾客页面和识别封页中，之后可以在后台修改。</p><label>店铺名称<input autoFocus required maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder="例如：校园自助打印店"/></label><label>打印站名称<input required maxLength={40} value={deviceName} onChange={e => setDeviceName(e.target.value)} placeholder="例如：一号打印站"/></label><label>店铺地址（选填）<input maxLength={100} value={address} onChange={e => setAddress(e.target.value)}/></label></>}
        {step === 1 && <p className="form-desc">先点击连接并保存默认打印机，再继续设置价格。尚未购买实体设备时，可选择标注为虚拟的队列进行 PDF 测试。</p>}
        {step === 2 && <><p className="form-desc">A4 黑白，按正文印刷面计费。每单识别封页和补空白页免费。</p><div className="form-columns"><label>单面单价（元 / 面）<input autoFocus required type="number" min="0.01" max="100" step="0.01" value={simplex} onChange={e => setSimplex(e.target.value)}/></label><label>双面单价（元 / 面）<input required type="number" min="0.01" max="100" step="0.01" value={duplex} onChange={e => setDuplex(e.target.value)}/></label></div><Alert type="info">双面纸张的两面分别计费。例如 4 页正文打印 1 份，按 4 个印刷面计算。当前自动模拟支付，不收取真钱。</Alert></>}
        {step === 3 && <><p className="form-desc">核对以下内容，点击完成后进入商家后台。</p><dl className="onboarding-review"><div><dt>店铺名称</dt><dd>{data.settings.shopName}</dd></div><div><dt>打印站</dt><dd>{data.settings.deviceName}</dd></div><div><dt>默认打印机</dt><dd>{data.printer.defaultPrinter?.name || '尚未选择'}</dd></div><div><dt>单面 / 双面单价</dt><dd>{money(data.settings.simplexPrice)} / {money(data.settings.duplexPrice)} 每面</dd></div></dl><label className="check-label"><input type="checkbox" checked={accepting} onChange={e => setAccepting(e.target.checked)}/><span>完成后开启测试接单</span></label><Alert type="info">当前仅生成 PDF，模拟支付不扣款；配置打印队列后仍不会自动出纸。实体打印执行与真实收款需另行接入。</Alert></>}
        {error && <Alert>{error}</Alert>}
        <div className="form-footer">{step > 0 ? <button type="button" className="secondary" disabled={busy} onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft size={16}/>上一步</button> : <span className="hint">完成设置前暂不接单</span>}<button className="primary" disabled={busy || (step === 1 && !data.printer.ready)}>{busy ? '保存中…' : step === 3 ? '完成设置，进入后台' : '保存并继续'}<ArrowRight size={16}/></button></div>
      </form>
    </section><div className="onboarding-footer">已有设置不会丢失，后续可在后台调整。<button className="text-button" onClick={() => post('/api/admin/logout').then(() => window.location.reload())}>退出登录</button></div>
  </main>;
}
