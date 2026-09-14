import { readFileSync } from 'node:fs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
const file = process.argv[2]; if (!file) throw new Error('用法: node scripts/verify-pdf.mjs path.pdf');
const task = getDocument({ data: new Uint8Array(readFileSync(file)), useSystemFonts: true }); const document = await task.promise;
const pages = [];
for (let n=1; n<=document.numPages; n++) { const page = await document.getPage(n); const content = await page.getTextContent(); pages.push(content.items.filter(i => 'str' in i).map(i => i.str).join(' ')); }
console.log(JSON.stringify({ pages: document.numPages, text: pages }, null, 2)); await task.destroy();
