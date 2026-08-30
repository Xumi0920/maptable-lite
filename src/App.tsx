// Maptable Lite 主应用
// 编排：数据状态 + 地图/表格双向联动 + 导入导出 + 字段管理 + 本地持久化

import { useMemo, useRef, useState, useCallback } from 'react';
import type { DataSet, FieldDef, LayerType, Selection } from './types';
import { useDataSet, useTableConfig } from './lib/usePersisted';
import { uid } from './lib/utils';
import { csvToDataSet, geojsonToDataSet, datasetToCsv, datasetToGeojson, downloadText, downloadJson } from './lib/io';
import MapPanel, { type MapPanelHandle } from './components/MapPanel';
import TablePanel from './components/TablePanel';
import './index.css';

const FIELD_TYPE_OPTIONS: Array<{ v: FieldDef['type']; label: string }> = [
  { v: 'text', label: '文本' },
  { v: 'number', label: '数值' },
  { v: 'date', label: '日期' },
  { v: 'coordinate', label: '坐标' },
  { v: 'select', label: '单选' },
];

function App() {
  const dsState = useDataSet();
  const dataSet = dsState.value;
  const setDataSet = dsState.setValue;
  const cfgState = useTableConfig();
  const config = cfgState.value;
  const setConfig = cfgState.setValue;

  const [layer, setLayer] = useState<LayerType>('scatter');
  const [selection, setSelection] = useState<Selection>({ rowIds: [] });
  const [drawer, setDrawer] = useState<'' | 'import' | 'fields'>('');
  const mapRef = useRef<MapPanelHandle>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  // 坐标字段：优先取第一个 coordinate 类型字段
  const coordField = useMemo(
    () => dataSet.fields.find((f) => f.type === 'coordinate') || dataSet.fields.find((f) => f.name.toLowerCase().includes('坐标')),
    [dataSet.fields],
  );

  // 更新单元格
  const updateCell = useCallback((rowId: string, fieldId: string, value: unknown) => {
    setDataSet((prev) => {
      const rows = { ...prev.rows };
      if (!rows[rowId]) return prev;
      rows[rowId] = { ...rows[rowId], [fieldId]: value };
      return { ...prev, rows };
    });
  }, [setDataSet]);

  // 新增行
  const addRow = useCallback(() => {
    setDataSet((prev) => {
      const id = uid('row');
      const row = { id };
      return { ...prev, rows: { ...prev.rows, [id]: row }, rowIds: [...prev.rowIds, id] };
    });
  }, [setDataSet]);

  // 删除行
  const deleteRows = useCallback((rowIds: string[]) => {
    const del = new Set(rowIds);
    setDataSet((prev) => {
      const rows = { ...prev.rows };
      rowIds.forEach((id) => delete rows[id]);
      return {
        ...prev,
        rows,
        rowIds: prev.rowIds.filter((id) => !del.has(id)),
        geometry: prev.geometry.filter((g) => !del.has(g.id)),
      };
    });
    setSelection({ rowIds: [] });
  }, [setDataSet]);

  // 切换坐标字段（地图图层数据源）
  const changeCoordField = useCallback((fieldId: string) => {
    setDataSet((prev) => {
      const fields = prev.fields.map((f) => ({ ...f, type: f.id === fieldId ? 'coordinate' : f.type }));
      return { ...prev, fields };
    });
  }, [setDataSet]);

  // 表格选中 → 地图联动（MapPanel 内部已处理 flight + 高亮）
  const selectRowsFromTable = useCallback((rowIds: string[]) => {
    setSelection({ rowIds });
  }, []);

  // 地图点击 → 表格联动：滚动到选中的行
  const handleMapSelect = useCallback((rowIds: string[]) => {
    setSelection({ rowIds });
    if (rowIds.length && rowRefs.current.has(rowIds[0])) {
      rowRefs.current.get(rowIds[0])?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, []);

  // 字段管理：新增字段
  const addField = useCallback((name: string, type: FieldDef['type']) => {
    if (!name) return;
    setDataSet((prev) => {
      const field: FieldDef = { id: uid('fld'), name, type, options: type === 'select' ? ['选项1', '选项2'] : undefined };
      return { ...prev, fields: [...prev.fields, field] };
    });
  }, [setDataSet]);

  // 删除字段
  const deleteField = useCallback((fieldId: string) => {
    setDataSet((prev) => {
      const fields = prev.fields.filter((f) => f.id !== fieldId);
      const rows: typeof prev.rows = {};
      Object.entries(prev.rows).forEach(([id, r]) => {
        const { [fieldId]: _removed, ...rest } = r;
        rows[id] = rest;
      });
      return { ...prev, fields, rows };
    });
  }, [setDataSet]);

  // 切换字段可见性
  const toggleFieldVisible = useCallback((fieldId: string) => {
    setConfig((prev) => {
      const cur = prev.visibleFieldIds.length ? prev.visibleFieldIds : dataSet.fields.map((f) => f.id);
      if (cur.includes(fieldId)) {
        return { ...prev, visibleFieldIds: cur.filter((id) => id !== fieldId) };
      }
      return { ...prev, visibleFieldIds: [...cur, fieldId] };
    });
  }, [setConfig, dataSet.fields]);

  // 导入（拖文件 / 选择文件）
  const handleImportFile = useCallback(async (file: File) => {
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase();
    let ds: DataSet;
    try {
      if (ext === 'geojson' || ext === 'json' || file.name.toLowerCase().includes('.geojson')) {
        ds = geojsonToDataSet(JSON.parse(text), file.name.replace(/\.[^.]+$/, ''));
      } else {
        ds = csvToDataSet(text, file.name.replace(/\.[^.]+$/, ''));
      }
    } catch (e) {
      alert(`导入失败：${String(e)}`);
      return;
    }
    setDataSet(ds);
    setSelection({ rowIds: [] });
    setDrawer('');
    alert(`导入成功：${ds.rowIds.length} 行 / ${ds.fields.length} 字段`);
  }, [setDataSet]);

  // 导出
  const handleExport = useCallback((kind: 'csv' | 'geojson' | 'json') => {
    const base = (dataSet.name || 'maptable').replace(/[\\/:*?"<>|]/g, '_') || 'data';
    if (kind === 'csv') {
      downloadText(`${base}.csv`, datasetToCsv(dataSet), 'text/csv;charset=utf-8');
    } else if (kind === 'geojson') {
      downloadJson(`${base}.geojson`, datasetToGeojson(dataSet));
    } else {
      downloadJson(`${base}.data.json`, dataSet);
    }
  }, [dataSet]);

  // 重置数据
  const resetData = useCallback(() => {
    if (!confirm('确认重置为示例数据？当前编辑内容将被覆盖。')) return;
    dsState.reset();
    setSelection({ rowIds: [] });
    setLayer('scatter');
  }, [dsState]);

  const hasKeyConfig = (import.meta.env.VITE_AMAP_KEY as string) || '';

  return (
    <div className="app-shell">
      {/* 顶栏 */}
      <header className="topbar">
        <div className="brand"><span className="logo">M</span> Maptable <span style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 400 }}>Lite</span></div>
        <span className="dataset-name">{dataSet.name}</span>
        <div className="spacer" />
        <div className="actions">
          <span className="key-status">{hasKeyConfig ? '● 高德已配置' : '○ 需配置高德Key'}</span>
          <button onClick={() => setDrawer('import')}>导入</button>
          <button onClick={() => handleExport('csv')}>导出CSV</button>
          <button onClick={() => handleExport('geojson')}>导出GeoJSON</button>
          <button onClick={() => setDrawer('fields')}>字段</button>
          <button onClick={resetData}>重置示例</button>
        </div>
      </header>

      {/* 主体 */}
      <div className="main-body">
        <MapPanel
          ref={mapRef}
          dataSet={dataSet}
          coordField={coordField}
          layer={layer}
          onLayerChange={setLayer}
          selection={selection}
          onSelectRows={handleMapSelect}
          onCoordFieldChange={changeCoordField}
        />

        <TablePanel
          dataSet={dataSet}
          selection={selection}
          onSelectRows={selectRowsFromTable}
          onUpdateCell={updateCell}
          onAddRow={addRow}
          onDeleteRows={deleteRows}
          filters={config.filters}
          sorts={config.sorts}
          onFiltersChange={(f) => setConfig((prev) => ({ ...prev, filters: f }))}
          onSortsChange={(s) => setConfig((prev) => ({ ...prev, sorts: s }))}
          visibleFieldIds={config.visibleFieldIds}
          rowRefs={rowRefs}
        />
      </div>

      {/* 抽屉：导入/导出 */}
      {drawer === 'import' && (
        <ImportDrawer onImport={handleImportFile} onExport={handleExport} onClose={() => setDrawer('')} />
      )}

      {/* 抽屉：字段管理 */}
      {drawer === 'fields' && (
        <FieldsDrawer
          dataSet={dataSet}
          config={config}
          onAddField={addField}
          onDeleteField={deleteField}
          onToggleVisible={toggleFieldVisible}
          onChangeCoordField={changeCoordField}
          onClose={() => setDrawer('')}
        />
      )}
    </div>
  );
}

/* ---------- 导入/导出抽屉 ---------- */
function ImportDrawer({ onImport, onExport, onClose }: {
  onImport: (file: File) => Promise<void>;
  onExport: (k: 'csv' | 'geojson' | 'json') => void;
  onClose: () => void;
}) {
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

/* ---------- 字段管理抽屉 ---------- */
function FieldsDrawer({ dataSet, config, onAddField, onDeleteField, onToggleVisible, onChangeCoordField, onClose }: {
  dataSet: DataSet;
  config: { visibleFieldIds: string[] };
  onAddField: (name: string, type: FieldDef['type']) => void;
  onDeleteField: (fieldId: string) => void;
  onToggleVisible: (fieldId: string) => void;
  onChangeCoordField: (fieldId: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldDef['type']>('text');
  const visibleSet = new Set(config.visibleFieldIds.length ? config.visibleFieldIds : dataSet.fields.map((f) => f.id));
  const coordField = dataSet.fields.find((f) => f.type === 'coordinate');
  const isCoordField = (f: FieldDef) => f.type === 'coordinate' || (coordField && f.id === coordField.id);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">字段管理 <button onClick={onClose} style={{ border: 'none', background: 'transparent' }}>✕</button></div>
        <div className="drawer-body">
          <h4>新增字段</h4>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <input placeholder="字段名" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
            <select value={type} onChange={(e) => setType(e.target.value as FieldDef['type'])}>
              {FIELD_TYPE_OPTIONS.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
            </select>
            <button onClick={() => { onAddField(name, type); setName(''); }}>添加</button>
          </div>

          <h4>字段列表</h4>
          {dataSet.fields.map((f) => (
            <div key={f.id} className="field-row">
              <input
                type="checkbox"
                checked={visibleSet.has(f.id)}
                onChange={() => onToggleVisible(f.id)}
                title="显示/隐藏列"
              />
              <span className="fname">{f.name}</span>
              <span className="ftype">{FIELD_TYPE_OPTIONS.find((o) => o.v === f.type)?.label || f.type}</span>
              {isCoordField(f) ? (
                <span style={{ color: 'var(--primary)', fontSize: 11 }}>✔ 地图坐标</span>
              ) : (
                <button
                  onClick={() => onChangeCoordField(f.id)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--muted)', fontSize: 11, padding: 2 }}
                  title="设为地图坐标字段"
                >设为坐标</button>
              )}
              <button
                onClick={() => { if (!confirm(`删除字段「${f.name}」？该列数据将一并删除。`)) return; onDeleteField(f.id); }}
                style={{ border: 'none', background: 'transparent', color: 'var(--danger)', padding: 2 }}
              >🗑</button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export default App;
