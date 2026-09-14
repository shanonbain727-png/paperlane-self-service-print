import { PDFDocument, rgb, degrees, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import sharp from 'sharp';
import QRCode from 'qrcode';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config, filePath, sofficePath } from './config.ts';
import type { FileRow, OrderRow, Snapshot, PrintAdapter, PaymentAdapter } from './types.ts';
const A4: [number, number] = [595.28, 841.89];
export const mockPayment: PaymentAdapter = { mode: 'mock', confirm: id => ({ reference: `mock-${id}` }) };
export const artifactPrinter: PrintAdapter = { mode: 'artifact', async submit(job) { return { state: 'artifact_ready', output: job.source }; } };

async function officeToPdf(file: FileRow) {
  const binary = sofficePath();
  if (!binary) throw new Error('Word 转换器尚未配置，请联系商家或先上传 PDF。');
  const dir = path.join(config.data, 'tmp', file.id);
  const profile = path.join(dir, 'profile');
  await mkdir(path.join(profile, 'user'), { recursive: true });
  await writeFile(path.join(profile, 'user/registrymodifications.xcu'), `<?xml version="1.0" encoding="UTF-8"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Writer/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>2</value></prop></item></oor:items>`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(binary, [`-env:UserInstallation=${pathToFileURL(profile).href}`, '--headless', '--nologo', '--norestore', '--convert-to', 'pdf:writer_pdf_Export', '--outdir', dir, filePath(file.id, 'original', file.ext)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (process.platform === 'win32' && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        else child.kill('SIGKILL');
      }, 120_000);
      child.stdout?.resume(); child.stderr?.resume();
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => { clearTimeout(timer); timedOut ? reject(new Error('文档转换超时，请导出为 PDF 后重试。')) : code !== 0 ? reject(new Error('Word 转换失败，请检查文件是否损坏或受密码保护。')) : resolve(); });
    });
    return await readFile(path.join(dir, `${file.id}.pdf`));
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function normalizeFile(file: FileRow): Promise<number> {
  const out = await PDFDocument.create();
  if (['png', 'jpg', 'jpeg'].includes(file.ext)) {
    const png = await sharp(filePath(file.id, 'original', file.ext), { limitInputPixels: 40_000_000 }).rotate().resize({ width: 3508, height: 3508, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
    const img = await out.embedPng(png);
    const landscape = img.width > img.height;
    const [w, h] = landscape ? [A4[1], A4[0]] : A4;
    const page = out.addPage([w, h]);
    const scale = Math.min((w - 40) / img.width, (h - 40) / img.height);
    page.drawImage(img, { x: (w - img.width * scale) / 2, y: (h - img.height * scale) / 2, width: img.width * scale, height: img.height * scale });
  } else {
    const bytes = file.ext === 'pdf' ? await readFile(filePath(file.id, 'original', file.ext)) : await officeToPdf(file);
    let input: PDFDocument;
    try { input = await PDFDocument.load(bytes); } catch { throw new Error('无法读取文档：文件可能已加密或损坏，请上传可正常打开的 PDF / Word。'); }
    if (!input.getPageCount() || input.getPageCount() > 500) throw new Error('每个文档应包含 1—500 页。');
    for (const source of input.getPages()) {
      const rot = ((source.getRotation().angle % 360) + 360) % 360;
      const box = source.getCropBox();
      const embed = await out.embedPage(source, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
      const [sw, sh] = rot % 180 ? [embed.height, embed.width] : [embed.width, embed.height];
      const [w, h] = sw > sh ? [A4[1], A4[0]] : A4;
      const scale = Math.min(w / sw, h / sh);
      let x = (w - sw * scale) / 2, y = (h - sh * scale) / 2;
      if (rot === 90) y += sh * scale;
      if (rot === 180) { x += sw * scale; y += sh * scale; }
      if (rot === 270) x += sw * scale;
      out.addPage([w, h]).drawPage(embed, { x, y, xScale: scale, yScale: scale, rotate: degrees(-rot) });
    }
  }
  await writeFile(filePath(file.id, 'converted'), await out.save());
  return out.getPageCount();
}

function wrap(text: string, font: PDFFont, size: number, max: number) {
  const lines: string[] = []; let line = '';
  for (const char of text) { if (char === '\n' || font.widthOfTextAtSize(line + char, size) > max) { lines.push(line); line = char === '\n' ? '' : char; } else line += char; }
  if (line) lines.push(line); return lines;
}
export async function renderOrder(order: OrderRow) {
  const snapshot: Snapshot = JSON.parse(order.snapshot);
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  // Full embedding preserves the static CJK font's glyph mappings across PDF readers.
  const font = await pdf.embedFont(await readFile(config.font), { subset: false });
  const cover = pdf.addPage(A4);
  const ink = rgb(.12, .17, .15);
  const draw = (text: string, y: number, size = 14) => {
    const safe = text.replace(/[\u0000-\u001f]/g, ' ');
    let yy = y; for (const line of wrap(safe, font, size, 475)) { cover.drawText(line, { x: 60, y: yy, size, font, color: ink }); yy -= size * 1.6; } return yy;
  };
  const shopTitle = snapshot.settings.shopName.replace(/[\u0000-\u001f]/g, ' ');
  draw(shopTitle, 760, Math.min(22, 475 / Math.max(1, font.widthOfTextAtSize(shopTitle, 1))));
  draw('自助打印 · 订单封页', 715, 12);
  cover.drawLine({ start: { x: 60, y: 690 }, end: { x: 535, y: 690 }, thickness: 1, color: rgb(.8, .82, .8) });
  draw('取件码', 650, 14); draw(order.code, 575, 58);
  if (snapshot.settings.showName && snapshot.name) draw(`称呼：${snapshot.name}`, 520, 16);
  draw(`正文 ${snapshot.pages} 页 × ${snapshot.copies} 份 · ${snapshot.duplex ? '双面（长边翻转）' : '单面'} · A4 黑白`, 467, 13);
  draw(`下单时间：${new Date(order.created).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`, 437, 12);
  let y = 392;
  const fileLines = snapshot.files.flatMap(f => wrap(`${f.name}  ·  ${f.pages} 页`.replace(/[\u0000-\u001f]/g, ' '), font, 11, 475));
  const visibleLines = fileLines.length > 10 ? [...fileLines.slice(0, 9), '更多文件请在订单详情查看'] : fileLines;
  for (const line of visibleLines) { draw(line, y, 11); y -= 18; }
  const qr = await pdf.embedPng(await QRCode.toBuffer(`PAPERLANE:ORDER:${order.code}`, { margin: 1, width: 180 }));
  cover.drawImage(qr, { x: 60, y: 90, width: 90, height: 90 });
  cover.drawText('订单识别码', { x: 65, y: 73, font, size: 10, color: ink });
  for (const [i, line] of wrap(snapshot.settings.coverNote, font, 11, 330).slice(0, 5).entries()) cover.drawText(line, { x: 180, y: 160 - i * 18, font, size: 11, color: ink });
  cover.drawText('测试订单 · 未扣款 · 本文件不代表实际打印完成', { x: 60, y: 38, font, size: 10, color: rgb(.45, .45, .45) });
  if (snapshot.duplex) pdf.addPage(A4);
  const body = await PDFDocument.create();
  for (const f of snapshot.files) { const source = await PDFDocument.load(await readFile(filePath(f.id, 'converted'))); for (const p of await body.copyPages(source, source.getPageIndices())) body.addPage(p); }
  for (let i = 0; i < snapshot.copies; i++) {
    for (const p of await pdf.copyPages(body, body.getPageIndices())) pdf.addPage(p);
    if (snapshot.duplex && body.getPageCount() % 2) pdf.addPage(A4);
  }
  pdf.setTitle(`${snapshot.settings.shopName} - ${order.code}`);
  await writeFile(filePath(order.id, 'output'), await pdf.save());
  await artifactPrinter.submit({ id: order.id, source: filePath(order.id, 'output'), duplex: snapshot.duplex, copies: 1 });
  return pdf.getPageCount();
}
