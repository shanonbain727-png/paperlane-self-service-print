import { useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Alert, Loading } from './lib';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export function PdfPreview({ url }: { url: string }) {
  const canvas = useRef<HTMLCanvasElement>(null), [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null), [page, setPage] = useState(1), [error, setError] = useState('');
  useEffect(() => { let active = true; const task = pdfjs.getDocument({ url, withCredentials: true }); setDoc(null); setPage(1); setError(''); task.promise.then(d => { if (active) setDoc(d); }).catch(e => { if (active) setError('预览加载失败，请稍后重试。'); }); return () => { active = false; void task.destroy(); }; }, [url]);
  useEffect(() => { if (!doc || !canvas.current) return; let active = true; let task: pdfjs.RenderTask | undefined;
    doc.getPage(page).then(p => { if (!active || !canvas.current) return; const width = Math.min(750, window.innerWidth - 70), base = p.getViewport({ scale: 1 }); const viewport = p.getViewport({ scale: width / base.width * Math.min(window.devicePixelRatio || 1, 2) }); canvas.current.width = viewport.width; canvas.current.height = viewport.height; task = p.render({ canvas: canvas.current, viewport }); task.promise.catch(e => { if (active && e.name !== 'RenderingCancelledException') setError('页面渲染失败'); }); });
    return () => { active = false; task?.cancel(); };
  }, [doc, page]);
  return <div className="pdf-preview">{error ? <Alert>{error}</Alert> : !doc ? <Loading/> : <><div className="pdf-toolbar"><button className="icon-button" disabled={page <= 1} aria-label="上一页" onClick={() => setPage(page - 1)}><ChevronLeft/></button><span>{page} / {doc.numPages} 页</span><button className="icon-button" disabled={page >= doc.numPages} aria-label="下一页" onClick={() => setPage(page + 1)}><ChevronRight/></button></div><p className="hint">排版预览保留原文件颜色，实际黑白效果需设备验证。</p></>}<canvas ref={canvas}/></div>;
}
