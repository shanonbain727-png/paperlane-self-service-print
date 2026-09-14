import { useRef, useState, type PointerEvent } from 'react';
import { FileText, GripVertical, ChevronUp, ChevronDown, Eye, Trash2, RotateCcw } from 'lucide-react';
import type { FileItem } from './lib';

type Props = {
  files: FileItem[];
  disabled: boolean;
  onMove: (from: string, to: string) => void;
  onPreview: (file: FileItem) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
};
const labels: Record<string, string> = { queued: '等待转换', processing: '正在转换', failed: '转换失败', expired: '已过期' };

export function SortableFiles({ files, disabled, onMove, onPreview, onRemove, onRetry }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const active = useRef<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  function finish() { if (active.current) setMessage('顺序已调整，PDF 将按当前顺序合并。'); active.current = null; setDragging(null); }
  function movePointer(e: PointerEvent<HTMLButtonElement>) {
    if (!active.current || disabled) return;
    const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-sort-file]');
    if (row && container.current?.contains(row) && row.dataset.sortFile !== active.current) onMove(active.current, row.dataset.sortFile!);
    if (e.clientY < 90) window.scrollBy(0, -18);
    else if (e.clientY > window.innerHeight - 90) window.scrollBy(0, 18);
  }
  return <div ref={container} className="sortable-files">
    <p className="sort-help"><GripVertical size={16}/>拖动左侧手柄排序，也可用上下按钮。每张图片一页，按顺序合并为一个 PDF。</p>
    <div className="file-list">{files.map((f, index) => <article data-sort-file={f.id} className={`file-row sortable-row ${dragging === f.id ? 'sorting' : ''}`} key={f.id}>
      <button className="sort-handle" aria-label={`拖动排序 ${f.name}`} title="拖动排序；键盘方向键也可移动" disabled={disabled}
        onPointerDown={e => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.focus(); active.current = f.id; setDragging(f.id); e.currentTarget.setPointerCapture(e.pointerId); }}
        onPointerMove={movePointer} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
        onKeyDown={e => { const next = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1; if (next >= 0 && next < files.length) { e.preventDefault(); onMove(f.id, files[next].id); setMessage(`${f.name} 已移至第 ${next + 1} 位`); } }}><GripVertical size={19}/></button>
      <span className="file-position">{index + 1}</span>
      {['png', 'jpg', 'jpeg'].includes(f.ext) && f.status === 'ready'
        ? <img className="file-thumbnail" src={`/api/files/${f.id}/thumbnail`} alt={f.name} draggable={false}/>
        : <span className={`file-icon ${f.ext === 'pdf' ? 'pdf' : ''}`}><FileText size={21}/></span>}
      <div className="file-info"><strong title={f.name}>{f.name}</strong><span>{(f.size / 1024 / 1024).toFixed(2)} MB · {f.status === 'ready' ? `${f.pages} 页` : labels[f.status] || f.status}</span>{f.error && <p className="file-error">{f.error}</p>}</div>
      <div className="file-actions">
        {f.status === 'ready' && <button aria-label={`预览 ${f.name}`} className="icon-button" onClick={() => onPreview(f)}><Eye size={17}/></button>}
        {f.status === 'failed' && <button className="icon-button" aria-label={`重新转换 ${f.name}`} disabled={disabled} onClick={() => onRetry(f.id)}><RotateCcw size={16}/></button>}
        <button className="icon-button" aria-label={`上移 ${f.name}`} disabled={disabled || index === 0} onClick={() => onMove(f.id, files[index - 1].id)}><ChevronUp size={15}/></button>
        <button className="icon-button" aria-label={`下移 ${f.name}`} disabled={disabled || index === files.length - 1} onClick={() => onMove(f.id, files[index + 1].id)}><ChevronDown size={15}/></button>
        <button className="icon-button" aria-label={`移除 ${f.name}`} disabled={disabled} onClick={() => onRemove(f.id)}><Trash2 size={16}/></button>
      </div>
    </article>)}</div>
    <span className="sr-only" role="status">{message}</span>
  </div>;
}
