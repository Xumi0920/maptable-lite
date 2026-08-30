// 导入/导出抽屉：拖拽/选择文件导入 CSV/GeoJSON，导出 CSV/GeoJSON/JSON

import { useRef, useState } from 'react';

export interface ImportDrawerProps {
  onImport: (file: File) => Promise<void>;
  onExport: (k: 'csv' | 'geojson' | 'json') => void;
  onClose: () => void;
}

export default function ImportDrawer({ onImport, onExport, onClose }: ImportDrawerProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">导入 / 导出 <button onClick={onClose} style={{ border: 'none', background: 'transparent' }}>✕</button></div>
        <div className="drawer-body">
          <h4>导入数据</h4>
          <div
            className={`dropzone${drag ? ' drag' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onImport(f); }}
          >
            <div style={{ fontSize: 26 }}>📄</div>
            <div>点击或拖拽文件到此上传</div>
            <div style={{ fontSize: 12, marginTop: 6 }}>支持 CSV / GEOJSON（自动识别经纬度）</div>
          </div>
          <input ref={fileRef} type="file" accept=".csv,.geojson,.json,text/csv,application/geo+json"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />

          <h4>导出数据</h4>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={() => onExport('csv')}>导出 CSV</button>
            <button onClick={() => onExport('geojson')}>导出 GeoJSON</button>
            <button onClick={() => onExport('json')}>导出数据(JSON)</button>
          </div>

          <h4>说明</h4>
          <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            数据保存在浏览器 localStorage 中。坐标字段将自动识别并用于地图展示。导出 GeoJSON 可再导入到其它 GIS 工具。
          </p>
        </div>
      </div>
    </>
  );
}
