import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Document, Packer, Paragraph, TextRun, Table, TableCell, TableRow, PageBreak, ImageRun, WidthType } from 'docx';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export async function createFixtures(dir: string) {
  await mkdir(dir, { recursive: true });
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#426e56' } }).composite([{ input: Buffer.from('<svg width="800" height="500"><rect x="70" y="80" width="220" height="280" rx="12" fill="#f4f6eb"/><circle cx="560" cy="220" r="100" fill="#d9e7c8"/><path d="M390 420L670 340" stroke="#e4b98d" stroke-width="15"/></svg>') }]).png().toBuffer();
  await writeFile(path.join(dir, 'sample-photo.png'), png);
  const jpeg = await sharp(png).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  await writeFile(path.join(dir, 'rotated-photo.jpg'), jpeg);
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await readFile('assets/NotoSansSC.ttf'), { subset: false });
  const img = await pdf.embedPng(png);
  for (let i = 0; i < 3; i++) {
    const page = pdf.addPage(i === 1 ? [841.89, 595.28] : [595.28, 841.89]);
    page.drawText(`纸间文档测试 · 第 ${i + 1} 页`, { x: 50, y: page.getHeight() - 80, font, size: 24, color: rgb(.15, .35, .25) });
    page.drawText(`PAGE-${i + 1} / 中文、数字 123 / A4`, { x: 50, y: page.getHeight() - 120, font, size: 14 });
    page.drawImage(img, { x: 50, y: 100, width: 320, height: 200 });
    if (i === 2) page.setRotation(degrees(90));
  }
  await writeFile(path.join(dir, 'three-pages.pdf'), await pdf.save());
  const doc = new Document({ styles: { default: { document: { run: { font: 'Microsoft YaHei', size: 24 } } } }, sections: [{ children: [
    new Paragraph({ children: [new TextRun({ text: '纸间 Word 转换验收', bold: true, size: 40 })] }),
    new Paragraph('这是自主生成的中文样例，用于检查字体、表格和图片。'),
    new Table({ width: { size: 9000, type: WidthType.DXA }, columnWidths: [3000, 2000, 4000], rows: [new TableRow({ children: ['项目', '数量', '说明'].map(t => new TableCell({ children: [new Paragraph(t)] })) }), new TableRow({ children: ['学习资料', '3 页', '包含中文与图片'].map(t => new TableCell({ children: [new Paragraph(t)] })) })] }),
    new Paragraph({ children: [new ImageRun({ data: png, transformation: { width: 320, height: 200 }, type: 'png' })] }),
    new Paragraph({ children: [new PageBreak()] }), new Paragraph('第二页：转换结果应当保持本页为独立页面。'), new Paragraph('WORD-PAGE-2'),
  ] }] });
  await writeFile(path.join(dir, 'sample-document.docx'), await Packer.toBuffer(doc));
}
if (process.argv[1]?.replaceAll('\\', '/').endsWith('/scripts/fixtures.ts')) { await createFixtures('examples'); console.log('测试样例已生成到 examples/'); }
