import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { UploadCloud, FileText, ArrowRight, ShieldCheck, Clock3, Layers, Check, Download, ArrowLeft, LoaderCircle } from 'lucide-react';
import { api, post, money, when, useLoad, Header, Footer, Alert, Badge, Loading, Empty, Modal, type Device, type FileItem, type Order } from '../lib';
import { PdfPreview } from '../PdfPreview';
import { SortableFiles } from '../SortableFiles';
const errorMessage = (e: unknown) => (e as Error).message;
export function Customer() {
  const { data: shop, error: shopError } = useLoad(() => api<Device>('/api/device'), [], 5000);
  const { data: files, reload, error: fileError } = useLoad(() => api<FileItem[]>('/api/files'), [], 1500);
  const [selected, setSelected] = useState<string[]>([]), [copies, setCopies] = useState(1), [duplex, setDuplex] = useState(false), [name, setName] = useState('');
  const [uploading, setUploading] = useState(false), [error, setError] = useState(''), [drag, setDrag] = useState(false), [preview, setPreview] = useState<FileItem | null>(null);
  const [busy, setBusy] = useState(false), [acceptedPreview, setAcceptedPreview] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ current: 0, total: 0 });
  const uploadLock = useRef(false), checkoutLock = useRef(false), quoteCache = useRef<{ key: string; id: string } | null>(null);
  const picker = useRef<HTMLInputElement>(null), initialized = useRef(false), navigate = useNavigate();
  useEffect(() => { if (files && !initialized.current) { initialized.current = true; setSelected(files.filter(f => f.status !== 'expired').slice(-10).map(f => f.id)); } }, [files]);
  const chosen = selected.map(id => files?.find(f => f.id === id)).filter((f): f is FileItem => !!f);
  const ready = chosen.length > 0 && chosen.every(f => f.status === 'ready' && f.expires > Date.now());
  const pages = chosen.reduce((n, f) => n + f.pages, 0), price = shop ? (duplex ? shop.duplexPrice : shop.simplexPrice) : 0;
  useEffect(() => setAcceptedPreview(false), [selected, duplex, copies]);
  async function upload(incoming: FileList | File[]) {
    if (uploadLock.current || checkoutLock.current) return;
    const list = Array.from(incoming); setError('');
    if (!list.length) return;
    if (selected.length + list.length > 10) return setError('每单最多选择 10 个文件。');
    if (chosen.reduce((n, f) => n + f.size, 0) + list.reduce((n, f) => n + f.size, 0) > 100 * 1024 * 1024) return setError('每单文件总大小不能超过 100 MB。');
    const invalid = list.find(f => !/\.(pdf|docx?|jpe?g|png)$/i.test(f.name) || !f.size || f.size > 30 * 1024 * 1024);
    if (invalid) return setError(invalid.name + '：请选择非空的 PDF、Word、JPG 或 PNG，单个文件不超过 30 MB。');
    uploadLock.current = true; setUploading(true);
    const failures: string[] = [];
    try {
      for (const [index, file] of list.entries()) {
        setUploadProgress({ current: index + 1, total: list.length });
        try {
          const form = new FormData(); form.append('file', file);
          const added = await api<FileItem>('/api/files', { method: 'POST', body: form });
          setSelected(prev => [...prev, added.id]); await reload();
        } catch (e) { failures.push(file.name + '：' + errorMessage(e)); }
      }
      if (failures.length) setError('部分文件上传失败，其他文件已保留。' + failures.join('；'));
    } finally { uploadLock.current = false; setUploading(false); void reload(); if (picker.current) picker.current.value = ''; }
  }
  function move(from: string, to: string) {
    setSelected(prev => { const start = prev.indexOf(from), end = prev.indexOf(to); if (start < 0 || end < 0 || start === end) return prev; const next = [...prev]; next.splice(start, 1); next.splice(end, 0, from); return next; });
  }
  async function checkout() {
    if (checkoutLock.current || uploadLock.current) return;
    checkoutLock.current = true; setBusy(true); setError('');
    try {
      const input = { fileIds: selected, copies, duplex, name }, key = JSON.stringify(input);
      if (quoteCache.current?.key !== key) { const quote = await post<{ id: string }>('/api/quotes', input); quoteCache.current = { key, id: quote.id }; }
      const order = await post<Order>('/api/orders', { quoteId: quoteCache.current!.id });
      navigate('/orders/' + order.id);
    } catch (e) { setError(errorMessage(e)); if (/报价已过期/.test(errorMessage(e))) quoteCache.current = null; }
    finally { checkoutLock.current = false; setBusy(false); }
  }
  return <><Header/><main className="customer-main"><div className="test-strip"><span className="dot"/> 体验模式 <span>自动模拟支付，不扣款；按顺序合并 PDF</span></div><section className="hero"><div className="eyebrow">PRINT YOUR NEXT CHAPTER</div><h1>上传一份文件，<br/>留下一份<span>清晰。</span></h1><p>文件、照片、学习资料，几步准备好。<br className="mobile-only"/> 从你的手机，走向纸面。</p><div className="station-pill"><span className={`status-dot ${shop?.accepting ? '' : 'offline'}`}/>{shop?.shopName || '纸间自助打印'}<span className="divider"/>{shop?.deviceName || '一号打印站'}<span className="station-mode">模拟设备</span></div><div className="paper-art" aria-hidden="true"><div className="sheet-back"/><div className="sheet-main"><span className="sheet-mark">P.</span><div className="paper-lines"><i/><i/><i/></div><span className="paper-a4">A4<br/>YOUR IDEAS,<br/>ON PAPER.</span></div><div className="paper-stamp"><Check size={24}/></div><span className="art-caption">一份整齐，刚刚好。</span></div></section>
    {shop && (shop.address || shop.hours || shop.phone) && <div className="shop-details" aria-label="店铺信息">{shop.address && <span>地址：{shop.address}</span>}{shop.hours && <span>营业：{shop.hours}</span>}{shop.phone && <span>客服：{shop.phone}</span>}</div>}
    <div className="steps"><span className="active"><b>01</b> 上传文件</span><i/><span><b>02</b> 确认设置</span><i/><span><b>03</b> 生成订单</span></div>
    {(error || shopError || fileError) && <Alert>{error || shopError || fileError}</Alert>}{shop && !shop.accepting && <Alert type="info">打印站暂停接单，你仍可查看已有订单。</Alert>}
    <div className="print-grid"><div className="print-left"><section className="panel upload-panel"><div className="section-heading"><h2><span className="step-no">01</span>上传你的文件</h2><span>{selected.length} / 10 个文件</span></div><input ref={picker} aria-label="选择打印文件" type="file" multiple accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" hidden onChange={e => e.target.files && void upload(e.target.files)}/><button className={`dropzone ${drag ? 'drag' : ''}`} disabled={busy || uploading || !shop?.accepting} onClick={() => picker.current?.click()} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); if (!busy && !uploading && shop?.accepting) void upload(e.dataTransfer.files); }}><span className="upload-icon">{uploading ? <LoaderCircle className="spin" size={29}/> : <UploadCloud size={29}/>}</span><strong>{uploading ? '正在上传 ' + uploadProgress.current + ' / ' + uploadProgress.total : '点击选择多张图片或文件'}</strong><span>支持多选 · JPG、PNG、PDF、Word · 单个不超过 30 MB</span><span className="select-file">{uploading ? '上传中…' : '选择文件'} <ArrowRight size={15}/></span></button>
      {!shop?.wordReady && shop && <p className="dependency-note">Word 转换器暂不可用，请先上传 PDF 或图片。</p>}
      {chosen.length > 0 && <SortableFiles files={chosen} disabled={busy || uploading} onMove={move} onPreview={setPreview} onRemove={id => setSelected(prev => prev.filter(fid => fid !== id))} onRetry={id => post('/api/files/' + id + '/retry').then(reload).catch(e => setError(e.message))}/>}
      {files && files.some(f => !selected.includes(f.id) && f.status !== 'expired') && <details className="stored-files"><summary>管理已上传文件</summary>{files.filter(f => !selected.includes(f.id) && f.status !== 'expired').map(f => <div key={f.id}><span>{f.name}</span><button className="text-button" disabled={busy || uploading || selected.length >= 10} onClick={() => setSelected(prev => [...prev, f.id])}>加入本单</button><button className="text-button danger" onClick={() => api(`/api/files/${f.id}`, { method: 'DELETE' }).then(reload).catch(e => setError(e.message))}>删除</button></div>)}</details>}
      <p className="privacy-note"><ShieldCheck size={15}/> 文件仅本人和商家可访问，默认保留 {shop?.retentionHours || 24} 小时。</p></section>
      <section className="panel settings-panel"><div className="section-heading"><h2><span className="step-no">02</span>打印设置</h2><span>整单统一设置</span></div><div className="setting-grid"><div><label>纸张与色彩</label><div className="fixed-setting"><FileText size={18}/><strong>A4</strong><span>黑白打印</span></div></div><div><label>打印方式</label><div className="segmented"><button className={!duplex ? 'selected' : ''} onClick={() => setDuplex(false)}>单面</button><button className={duplex ? 'selected' : ''} onClick={() => setDuplex(true)}>双面</button></div></div><div><label htmlFor="copies">打印份数</label><div className="quantity"><button aria-label="减少份数" disabled={copies <= 1} onClick={() => setCopies(copies - 1)}>−</button><input id="copies" type="number" min={1} max={20} value={copies} onChange={e => setCopies(Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))))}/><button aria-label="增加份数" disabled={copies >= 20} onClick={() => setCopies(copies + 1)}>＋</button></div></div><div><label htmlFor="nickname">封页称呼 <span>选填</span></label><input id="nickname" maxLength={30} value={name} onChange={e => setName(e.target.value)} placeholder="例如：陈同学"/></div></div><div className="cover-note"><Layers size={19}/><div><strong>每单附一张识别封页，免费</strong><p>取件码帮你辨认资料。{duplex ? '双面长边翻转，封页背面留白，每份从新纸开始。' : '封页在最前面，正文按文件顺序连续排列。'}</p></div></div></section></div>
      <aside><section className="panel summary"><span className="eyebrow">YOUR PRINT ORDER</span><h2>这份打印</h2><div className="summary-line"><span>文件数量</span><strong>{chosen.length} 个</strong></div><div className="summary-line"><span>正文页数</span><strong>{ready ? pages : '—'} 页 / 份</strong></div><div className="summary-line"><span>打印规格</span><strong>A4 · 黑白 · {duplex ? '双面' : '单面'}</strong></div><div className="summary-line"><span>打印份数</span><strong>{copies} 份</strong></div><div className="summary-line"><span>每个正文印刷面</span><strong>{money(price)}</strong></div><div className="summary-line"><span>识别封页 / 补空白页</span><strong className="green">免费</strong></div><div className="total"><span>预估金额</span><strong><small>¥</small>{(ready ? pages * copies * price / 100 : 0).toFixed(2)}</strong></div><p className="hint">按正文印刷面计费，双面纸张两面分别计费。最终以确认报价为准。</p><label className="check-label"><input type="checkbox" checked={acceptedPreview} disabled={!ready} onChange={e => setAcceptedPreview(e.target.checked)}/><span>我已检查文件预览与打印设置</span></label><button className="primary full" disabled={!ready || !acceptedPreview || busy || uploading || !shop?.accepting} onClick={checkout}>{busy ? '正在核算…' : '生成合并 PDF'}<ArrowRight size={17}/></button><div className="mock-caption">下单即自动模拟支付成功 · 不会扣款</div></section><div className="side-note"><Clock3 size={18}/><div><strong>不用守在电脑旁</strong><p>订单生成后，可在「我的订单」<br/>查看处理状态和下载文件。</p></div></div></aside></div>
    <div className="service-notes"><span><ShieldCheck size={17}/> 私有文件访问</span><span><Layers size={17}/> 自动生成识别封页</span><span><Clock3 size={17}/> 保留 {shop?.retentionHours || 24} 小时后清理</span></div></main><Footer/>
    {preview && <Modal wide title={preview.name} onClose={() => setPreview(null)}><PdfPreview url={`/api/files/${preview.id}/pdf`}/></Modal>}

  </>;
}
export function OrderDetail({ merchant = false, orderId }: { merchant?: boolean; orderId?: string }) {
  const params = useParams(), id = orderId || params.id;
  const { data: order, error, reload } = useLoad(() => api<Order>(`/api/orders/${id}`), [id], 1500);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  async function act(action: string) { setBusy(true); setActionError(''); try { await post(action); await reload(); } catch (e) { setActionError(errorMessage(e)); } finally { setBusy(false); } }
  const content = <>{error && <Alert>{error}</Alert>}{actionError && <Alert>{actionError}</Alert>}{!order ? !error && <Loading/> : <><section className="panel order-hero"><Badge status={order.status}/><p className="eyebrow">你的取件码</p><h1 className="pickup-code">{order.code}</h1><p>{order.status === 'ready' ? '封页和资料已整理好，可以下载待打印文件。' : order.status === 'generating' ? '正在整理封页和资料，请稍候。' : order.status === 'awaiting_payment' ? '这是旧版未完成订单，继续后将自动模拟支付并生成 PDF。' : '订单状态和处理记录见下方。'}</p><div className="order-hero-actions">{order.status === 'awaiting_payment' && <><button className="primary" disabled={busy} onClick={() => act(`/api/orders/${id}/pay`)}>继续生成 PDF · 自动模拟支付</button><button className="secondary" disabled={busy} onClick={() => act(`/api/orders/${id}/cancel`)}>取消订单</button></>}{order.outputAvailable && <a className="primary" href={`/api/orders/${id}/pdf`}><Download size={18}/>下载合并 PDF</a>}{merchant && order.status === 'failed' && order.expires > Date.now() && <button className="primary" disabled={busy} onClick={() => act(`/api/admin/orders/${id}/retry`)}>重试生成</button>}</div>{order.error && <Alert>{order.error}</Alert>}<div className="mock-caption">测试订单未扣款 · 文件生成不代表实体打印完成</div></section><section className="panel order-info"><h2>订单详情</h2><dl><div><dt>打印规格</dt><dd>A4 / 黑白 / {order.snapshot.duplex ? '双面长边翻转' : '单面'}</dd></div><div><dt>正文数量</dt><dd>{order.snapshot.pages} 页 × {order.snapshot.copies} 份</dd></div><div><dt>订单金额（测试）</dt><dd>{money(order.snapshot.amount)}</dd></div><div><dt>封页称呼</dt><dd>{order.snapshot.name || '未填写'}</dd></div><div><dt>下单时间</dt><dd>{when(order.created)}</dd></div><div><dt>文件保留至</dt><dd>{when(order.expires)}</dd></div>{order.output_pages > 0 && <div><dt>输出总页数</dt><dd>{order.output_pages} 页（含封页与补空白）</dd></div>}</dl><h3>文件清单</h3>{order.snapshot.files.map(f => <div className="order-file" key={f.id}><FileText size={18}/><span>{f.name}</span><strong>{f.pages} 页</strong></div>)}</section><section className="panel timeline"><h2>处理记录</h2>{order.events?.map((e, i) => <div key={i}><span className="timeline-dot"/><p>{e.action}<small>{when(e.created)}</small></p></div>)}</section></>}</>;
  if (merchant) return <div className="merchant-order-detail">{content}</div>;
  return <><Header/><main className="narrow-main"><Link className="back-link" to="/orders"><ArrowLeft size={16}/>我的订单</Link>{content}</main><Footer/></>;
}
export function MyOrders() {
  const { data: orders, error } = useLoad(() => api<Order[]>('/api/orders'), [], 3000);
  return <><Header/><main className="narrow-main"><Link className="back-link" to="/"><ArrowLeft size={16}/>返回打印</Link><div className="page-title"><span className="eyebrow">MY ORDERS</span><h1>我的订单</h1><p>每一份资料，都有迹可循。</p></div>{error && <Alert>{error}</Alert>}{!orders ? !error && <Loading/> : orders.length ? <div className="customer-orders">{orders.map(o => <Link className="panel order-card" to={`/orders/${o.id}`} key={o.id}><div><strong>取件码 {o.code}</strong><Badge status={o.status}/></div><p>{o.snapshot.files.map(f => f.name).join('、')}</p><div><span>{when(o.created)} · {o.snapshot.pages} 页 × {o.snapshot.copies} 份</span><strong>{money(o.snapshot.amount)} <ArrowRight size={15}/></strong></div></Link>)}</div> : <section className="panel"><Empty/><div className="empty-action"><Link className="primary" to="/">上传第一份文件 <ArrowRight size={16}/></Link></div></section>}<p className="hint">订单通过当前浏览器的会话识别。清除浏览器数据或更换设备后，请联系商家查询。</p></main><Footer/></>;
}
