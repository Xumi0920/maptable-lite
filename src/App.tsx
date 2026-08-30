// Maptable Lite 主应用 —— 纯编排组件
// 职责：组合布局 + 管理全局状态（数据集/视图配置/选中/抽屉/仪表盘）
// 具体数据操作逻辑见 hooks/useDataSetActions，抽屉组件见 components/drawers/

import { useMemo, useRef, useState, useCallback } from 'react';
import type { DataSet, LayerType, Selection } from './types';
import { useDataSet, useTableConfig } from './lib/usePersisted';
import { csvToDataSet, geojsonToDataSet, datasetToCsv, datasetToGeojson, downloadText, downloadJson } from './lib/io';
import { useDataSetActions } from './hooks/useDataSetActions';
import MapPanel, { type MapPanelHandle } from './components/MapPanel';
import TablePanel from './components/TablePanel';
import DashboardPanel from './components/DashboardPanel';
import ImportDrawer from './components/drawers/ImportDrawer';
import FieldsDrawer from './components/drawers/FieldsDrawer';
import './index.css';

function App() {
  const dsState = useDataSet();
  const dataSet = dsState.value;
  const cfgState = useTableConfig();
  const config = cfgState.value;
  const setConfig = cfgState.setValue;

  const [layer, setLayer] = useState<LayerType>('scatter');
  const [selection, setSelection] = useState<Selection>({ rowIds: [] });
  const [drawer, setDrawer] = useState<'' | 'import' | 'fields'>('');
  const [showDashboard, setShowDashboard] = useState(false);
  const mapRef = useRef<MapPanelHandle>(null);
  const rowRefs = useRef<Map<string, HTMLElement>>(new Map());

  // 数据操作（抽到 hook，模块化）
  const { updateCell, addRow, deleteRows, changeCoordField, addField, deleteField, replaceDataSet } = useDataSetActions(dsState);

  // 坐标字段：优先取第一个 coordinate 类型字段
  const coordField = useMemo(
    () => dataSet.fields.find((f) => f.type === 'coordinate') || dataSet.fields.find((f) => f.name.toLowerCase().includes('坐标')),
    [dataSet.fields],
  );

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
    replaceDataSet(ds);
    setSelection({ rowIds: [] });
    setDrawer('');
    alert(`导入成功：${ds.rowIds.length} 行 / ${ds.fields.length} 字段`);
  }, [replaceDataSet]);

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
          <button className="primary" onClick={() => setShowDashboard(true)}>📊 仪表盘</button>
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

      {/* 仪表盘面板 */}
      {showDashboard && (
        <DashboardPanel dataSet={dataSet} coordField={coordField} onClose={() => setShowDashboard(false)} />
      )}
    </div>
  );
}

export default App;
