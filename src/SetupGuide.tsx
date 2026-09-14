import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Check, RefreshCw } from 'lucide-react';
import { api, Alert, Loading, useLoad } from './lib';
import type { PrinterState } from '../server/printers';

type SetupState = { wordReady: boolean; fontReady: boolean; printer: PrinterState; accepting: boolean; url: string };

export function SetupPrompt() {
  return <section className="setup-prompt"><BookOpen size={23}/><div><strong>安装帮助与设备维护</strong><p>查看安装说明、检查运行状态，或调整打印机和店铺设置。</p></div><Link className="secondary" to="/merchant/setup">查看设置指南 <ArrowRight size={16}/></Link></section>;
}

export function SetupGuide() {
  const { data, error, reload } = useLoad(() => api<SetupState>('/api/admin/device'), [], 5000);
  const checks = data ? [data.wordReady && data.fontReady, data.printer.ready, data.accepting] : [];
  const complete = checks.filter(Boolean).length;
  return <>
    <div className="merchant-page-heading"><div><span className="eyebrow">GET YOUR STATION READY</span><h1>安装与设置</h1><p>先准备运行电脑，再连接设备，最后检查顾客扫码流程。</p></div><button className="secondary" onClick={reload}><RefreshCw size={16}/>刷新状态</button></div>
    {error && <Alert>{error}</Alert>}
    {!data ? <Loading/> : <section className="setup-progress panel"><div><strong>{complete === 3 ? '测试接单配置已就绪' : '继续完成打印站设置'}</strong><span>{complete} / 3 项运行条件已就绪</span></div><progress aria-label="运行条件配置进度" max={3} value={complete}/><p>{complete === 3 ? '可以检查上传、文件转换和 PDF 下载流程。实体出纸仍需接入打印执行端。' : !checks[0] ? '下一步：检查文档转换环境。' : !checks[1] ? `下一步：连接默认打印机。${data.printer.reason}` : '下一步：在设备管理中开启接单并保存。'}</p></section>}
    <div className="setup-steps">
      <section className="panel setup-step"><div className="setup-step-title"><span className="step-no">01</span><h2>准备电脑与安装环境</h2><span className={`setup-status ${checks[0] ? 'done' : ''}`}>{checks[0] ? <><Check size={14}/>环境路径已检测</> : '待检查'}</span></div><p>服务应运行在能访问打印机的店内电脑上。营业期间保持电脑开机、联网并关闭自动休眠。</p>
        <details><summary>首次部署：安装与启动步骤</summary><ol><li>安装 Git、Node.js 24.15.0 或更高的 24.x 版本，以及 LibreOffice 和文档所需的中文字体。</li><li>下载源码，在项目目录依次执行：</li></ol><pre><code>{'git clone https://github.com/shanonbain727-png/paperlane-self-service-print.git\ncd paperlane-self-service-print\nnpm ci\nnpm run setup\nnpm run check\nnpm run build\nnpm start'}</code></pre><p>初始化密码保存在本机 <code>.env</code> 的 <code>ADMIN_PASSWORD</code> 中。已有数据库的密码通过后台「基础设置」修改。</p></details>
        <details><summary>Word 无法转换或提示字体未配置</summary><p>安装 LibreOffice 后，在项目 <code>.env</code> 中设置 <code>SOFFICE_PATH</code>，保存并重启服务。Windows 示例：</p><pre><code>SOFFICE_PATH=C:/Program Files/LibreOffice/program/soffice.com</code></pre><p>Linux 常用路径为 <code>/usr/bin/libreoffice</code>，以实际安装位置为准。中文封页字体随源码提供；若提示缺失，检查 <code>FONT_PATH</code> 是否指向存在的字体文件。</p></details>
        <div className="setup-checks"><span>Word 转换路径：{data ? data.wordReady ? '已检测到' : '未检测到' : '检查中'}</span><span>中文封页字体：{data ? data.fontReady ? '已检测到' : '未检测到' : '检查中'}</span></div><p className="hint">路径存在不代表所有文档都能转换，请用实际 Word 文件验证。</p>
      </section>
      <section className="panel setup-step"><div className="setup-step-title"><span className="step-no">02</span><h2>连接打印机，选择默认设备</h2><span className={`setup-status ${checks[1] ? 'done' : ''}`}>{checks[1] ? <><Check size={14}/>已配置</> : '待配置'}</span></div><ol><li>USB 连接：将打印机接到服务电脑，安装厂商驱动。网络连接：在同一网络下，先通过 IP、IPP 或共享名称添加系统打印机。</li><li>先从操作系统打印一张测试页，再进入「设备管理」，点击「连接打印机」。Linux 使用 CUPS 队列，需先安装并启动 CUPS。</li><li>在检测列表中选择设备，点击「设为默认打印机」。设置重启后保留，不修改系统默认打印机。</li></ol><p className="setup-current">本站默认：<strong>{data?.printer.defaultPrinter?.name || '尚未选择'}</strong></p><p className="hint">PDF、XPS、传真等虚拟队列仅供测试，不会出纸。列表来自服务电脑；云端部署需另接店内打印执行端。</p><Link className="secondary" to="/merchant/device">去连接打印机 <ArrowRight size={16}/></Link></section>
      <section className="panel setup-step"><div className="setup-step-title"><span className="step-no">03</span><h2>检查店铺设置，开启测试接单</h2><span className={`setup-status ${checks[2] ? 'done' : ''}`}>{checks[2] ? <><Check size={14}/>已开启</> : '待开启'}</span></div><p>检查店名、地址、打印价格及识别封页。确认默认打印机可用后，在「设备管理」打开「允许顾客下单」并保存设置。</p><div className="setup-links"><Link to="/merchant/settings">店铺资料与密码 <ArrowRight size={14}/></Link><Link to="/merchant/prices">打印价格 <ArrowRight size={14}/></Link><Link to="/merchant/cover">识别封页 <ArrowRight size={14}/></Link><Link to="/merchant/device">接单开关 <ArrowRight size={14}/></Link></div><p className="hint">未选择默认打印机或队列不可用时，系统会暂停新订单，后台仍可进入配置。</p></section>
      <section className="panel setup-step"><div className="setup-step-title"><span className="step-no">04</span><h2>扫码完成一次实际体验</h2><span className="setup-status">需人工验证</span></div><p>手机和电脑连接同一网络。停止原服务后，在项目目录运行 <code>npm run lan</code>，然后从「设备管理」下载最新入口二维码。</p><ol><li>用手机扫码，上传 Word、PDF 或多张图片。</li><li>拖动图片排序，检查文件预览、份数和封页信息，再生成合并 PDF。</li><li>在「我的订单」下载结果，并到商家「订单管理」核对记录。</li></ol><p className="setup-current">当前入口：<code>{data?.url || '读取中…'}</code></p><div className="setup-links"><Link to="/merchant/device">获取入口二维码 <ArrowRight size={14}/></Link><Link to="/" target="_blank" rel="noopener noreferrer">打开顾客端 <ArrowRight size={14}/></Link><Link to="/merchant/orders">查看订单 <ArrowRight size={14}/></Link></div></section>
    </div>
    <Alert type="info">当前为测试版本：自动模拟支付、不扣款，只生成 PDF。完成上述设置后仍不会自动出纸，实体打印执行与真实收款需要另行接入并验收。</Alert>
  </>;
}
