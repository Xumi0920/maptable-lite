// 飞书多维表格仪表盘插件主组件
// 配置模式：getTableMetaList 列所有表→选表→读字段→选坐标字段→saveConfig
// 展示模式：用 config.tableId，getTableById 读该表字段+记录→DataSet→渲染地图
//
// 关键（已修复）：
//  - 配置模式下 getActiveTable() 抛 "table not found" → 改用 getTableMetaList/getTableById（显式 tableId）
//  - SDK IField 的 name/type 是异步方法 getName()/getType() → bitableFieldToLike 兼容处理
//
// 调试：展示模式顶部显示诊断条（config.tableId / 表数量 / 加载状态 / 错误），
//       便于真实飞书环境下定位卡点。

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { useTheme, useConfig } from './hooks';
import { dataSetFromBitable, type BitableFieldLike, type BitableRecordLike } from './bitableToDataSet';
import { findRegionField, findMetricField, type RegionAggMode } from '../lib/regions';
import type { DataSet, LayerType, Selection, FieldDef } from '../types';
import MapPanel from '../components/MapPanel';
import RegionMapPanel from '../components/RegionMapPanel';
import '../index.css';

interface PluginConfig {
  tableId: string;
  coordFieldId: string;
  coordFieldName: string;
}

const DEFAULT_CONFIG: PluginConfig = { tableId: '', coordFieldId: '', coordFieldName: '' };

interface TableMeta { id: string; name: string }

// 展示模式样式常量
const vizBtn: CSSProperties = { padding: '4px 12px', borderRadius: 6, border: '1px solid #d9d9d9', fontSize: 12, cursor: 'pointer' };
const selStyle: CSSProperties = { padding: '4px 8px', borderRadius: 6, border: '1px solid #ccc', fontSize: 12 };

export default function FeishuPluginApp() {
  const { bgColor, theme } = useTheme();
  const { config, setConfig, saveConfig, setRendered, isConfig } = useConfig<PluginConfig>(DEFAULT_CONFIG);

  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [fields, setFields] = useState<BitableFieldLike[]>([]);
  const [fieldError, setFieldError] = useState('');
  const [debug, setDebug] = useState('初始化');
  const [layer, setLayer] = useState<LayerType>('scatter');
  const [selection, setSelection] = useState<Selection>({ rowIds: [] });
  // 展示模式可视化切换：点位 / 区域地图
  const [viz, setViz] = useState<'scatter' | 'region'>('scatter');
  const [regionFieldId, setRegionFieldId] = useState('');
  const [regionMetricId, setRegionMetricId] = useState('');
  const [regionMode, setRegionMode] = useState<RegionAggMode>('sum');

  const hasKey = (import.meta.env.VITE_AMAP_KEY as string) || '';

  // 区域地图字段（自动识别 + 下拉）
  const regionFieldSel = useMemo(() => {
    if (regionFieldId) return regionFieldId;
    return dataSet ? (findRegionField(dataSet)?.id || '') : '';
  }, [dataSet, regionFieldId]);
  const regionMetricSel = useMemo(() => {
    if (regionMetricId) return regionMetricId;
    return dataSet ? (findMetricField(dataSet)?.id || '') : '';
  }, [dataSet, regionMetricId]);
  const regionTextFields = useMemo(() => dataSet ? dataSet.fields.filter((f) => f.type === 'text' || f.type === 'select') : [], [dataSet]);
  const regionNumFields = useMemo(() => dataSet ? dataSet.fields.filter((f) => f.type === 'number') : [], [dataSet]);

  // 拉取多维表格下所有表（用 getTableList 拿标准数据表实例，确保 id 是标准表 id）
  const loadTableList = useMemo(() => async () => {
    setDebug('正在获取表列表...');
    const tables = await bitable.base.getTableList();
    const list: TableMeta[] = await Promise.all(
      (tables || []).map(async (t: any) => {
        let name = '';
        try { name = await t.getName(); } catch { /* ignore */ }
        return { id: t.id, name: name || t.id };
      })
    );
    setTables(list);
    setDebug(`表列表 ${list.length} 张（id 前4位: ${list[0]?.id?.slice(0, 4) || '无'}）`);
    return list;
  }, []);

  // 读取指定表 字段+记录 → DataSet
  const loadData = useMemo(() => async (tableId: string) => {
    setDebug(`读取表 ${tableId} ...`);
    const table = await bitable.base.getTableById(tableId);
    const meta = await table.getMeta();
    setDebug(`表: ${meta.name}, 取字段...`);
    const fList: BitableFieldLike[] = ((await table.getFieldMetaList()) || []).map((f: any) => ({ id: f.id, name: f.name, type: f.type }));
    setFields(fList);
    setDebug(`字段 ${fList.length} 个, 取记录...`);
    const recordList: BitableRecordLike[] = [];
    const list = await table.getRecordList();
    for await (const rec of list) {
      recordList.push({ recordId: rec.id, getCellByField: (fieldId: string) => rec.getCellByField(fieldId) });
    }
    setDebug(`记录 ${recordList.length} 条, 转换...`);
    const ds = await dataSetFromBitable(fList, recordList, meta.name || '飞书多维表格');
    setDataSet(ds);
    setLoading(false);
    setDebug(`完成: ${ds.rowIds.length} 条`);
    setRendered(2500);
  }, []);

  // 配置模式：读某表字段（供选坐标字段）
  const loadFieldsOfTable = useMemo(() => async (tableId: string) => {
    const table = await bitable.base.getTableById(tableId);
    const fList: BitableFieldLike[] = ((await table.getFieldMetaList()) || []).map((f: any) => ({ id: f.id, name: f.name, type: f.type }));
    setFields(fList);
    return fList;
  }, []);

  // 首次加载
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadTableList();  // 只更新 tables state，不用返回值（展示模式读 config.tableId 指定的表）
        if (cancelled) return;
        const useTableId = config.tableId || '';  // 只用配置保存的表 id（等 getConfig 返回后再加载，避免拿到错误的第一张表）
        if (!isConfig) {
          if (useTableId) {
            setTableSelection(useTableId);
            await loadData(useTableId);
          } else {
            setLoading(false);
            setDebug('无 tableId（尚未配置）');
          }
        } else {
          // 配置模式
          if (useTableId) {
            setTableSelection(useTableId);
            setConfig((prev) => prev.tableId ? prev : { ...prev, tableId: useTableId });
            try {
              await loadFieldsOfTable(useTableId);
              setFieldError('');
            } catch (e: any) {
              setFieldError(String(e?.message || e));
            }
          }
          setLoading(false);
        }
      } catch (e: any) {
        if (cancelled) return;
        setFieldError(String(e?.message || e));
        setDebug(`异常: ${String(e?.message || e)}`);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.tableId]);

  const [tableSelection, setTableSelection] = useState('');
  const onTableChange = async (tableId: string) => {
    setTableSelection(tableId);
    setConfig((prev) => ({ ...prev, tableId, coordFieldId: '', coordFieldName: '' }));
    try {
      setFieldError('');
      await loadFieldsOfTable(tableId);
    } catch (e: any) {
      setFieldError(String(e?.message || e));
      setFields([]);
    }
  };

  // 坐标字段：地理位置(22)优先，否则含"坐标/位置/lng/lat/经纬"的字段
  const coordField = useMemo<FieldDef | undefined>(() => {
    if (!dataSet) return undefined;
    const geoField = dataSet.fields.find((f) => f.type === 'coordinate');
    if (geoField) return geoField;
    return dataSet.fields.find((f) => f.name.toLowerCase().includes('坐标') || f.name.toLowerCase().includes('位置') || f.name.toLowerCase().includes('经纬'));
  }, [dataSet]);

  const coordCandidates = useMemo(() => {
    return fields.map((f) => ({
      id: f.id, name: f.name,
      isCoord: Number(f.type) === 22 || /坐标|位置|经纬|lng|lat/i.test(f.name),
    }));
  }, [fields]);
  const defaultCoord = coordCandidates.find((c) => c.isCoord)?.id || coordCandidates[0]?.id || '';

  // 配置模式 UI
  if (isConfig) {
    const selId = config.coordFieldId || defaultCoord;
    const selName = coordCandidates.find((c) => c.id === selId)?.name || '';
    return (
      <main style={{ backgroundColor: bgColor, padding: 16, fontFamily: 'inherit', minHeight: '100vh', color: theme === 'dark' ? '#e5e6eb' : '#1f2329' }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15 }}>地图组件配置</h3>

        <div style={{ fontSize: 13, marginBottom: 6 }}>数据表：</div>
        <select value={tableSelection} onChange={(e) => onTableChange(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}>
          {tables.length === 0 && <option value="">（加载表列表…）</option>}
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        <div style={{ color: '#8a919f', fontSize: 11, marginTop: 6 }}>诊断: {debug} · 表数 {tables.length}</div>

        {fieldError ? (
          <div style={{ background: '#fff1f0', color: '#d4380d', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10, wordBreak: 'break-all' }}>
            ⚠ {fieldError}
          </div>
        ) : fields.length > 0 ? (
          <div style={{ color: '#52c41a', fontSize: 12, marginTop: 10 }}>✓ 已读取 {fields.length} 个字段</div>
        ) : (
          <div style={{ color: '#8a919f', fontSize: 12, marginTop: 10 }}>正在读取字段…</div>
        )}

        <div style={{ fontSize: 13, marginTop: 12, marginBottom: 6 }}>选择要在地图上定位的「坐标字段」：</div>
        {fields.length > 0 ? (
          <select value={selId} onChange={(e) => setConfig((prev) => ({ ...prev, coordFieldId: e.target.value, coordFieldName: coordCandidates.find((c) => c.id === e.target.value)?.name || '', tableId: tableSelection }))}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}>
            {coordCandidates.map((c) => <option key={c.id} value={c.id}>{c.name}{c.isCoord ? '（坐标）' : ''}</option>)}
          </select>
        ) : (
          <input type="text" placeholder="手动输入坐标字段名（如：坐标 / 经纬度）"
            value={config.coordFieldName}
            onChange={(e) => setConfig((prev) => ({ ...prev, coordFieldName: e.target.value }))}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box' }} />
        )}

        <button onClick={() => saveConfig({ ...config, tableId: tableSelection, coordFieldId: fields.length ? selId : '', coordFieldName: fields.length ? selName : config.coordFieldName })}
          style={{ marginTop: 14, padding: '8px 20px', borderRadius: 6, border: 'none', background: '#3370ff', color: '#fff', fontSize: 13, cursor: 'pointer' }}>保存</button>
        <div style={{ fontSize: 11, color: '#8a919f', marginTop: 12 }}>
          提示：坐标字段应为「地理位置」类型（存经纬度，如 116.40,39.90）。配置保存后，组件将在地图上渲染该表数据。
        </div>
      </main>
    );
  }

  // 展示模式
  return (
    <main style={{ backgroundColor: bgColor, minHeight: '100vh', display: 'flex', flexDirection: 'column', color: theme === 'dark' ? '#e5e6eb' : '#1f2329' }}>
      {!hasKey && (
        <div style={{ padding: 12, background: '#fff7e6', color: '#d48806', fontSize: 13 }}>⚠ 未配置高德地图 Key（VITE_AMAP_KEY），地图无法加载。</div>
      )}
      <div style={{ padding: '4px 12px', fontSize: 11, color: '#8a919f', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
        诊断: {debug} · tableId={config.tableId || '(空)'} · 表数 {tables.length}
      </div>

      {/* 可视化类型切换（点位 / 区域地图） */}
      <div style={{ display: 'flex', gap: 6, padding: '6px 12px', borderBottom: '1px solid rgba(0,0,0,0.06)', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#8a919f' }}>可视化：</span>
        <button onClick={() => setViz('scatter')} style={{ ...vizBtn, background: viz === 'scatter' ? '#3370ff' : '#fff', color: viz === 'scatter' ? '#fff' : '#333' }}>点位地图</button>
        <button onClick={() => setViz('region')} style={{ ...vizBtn, background: viz === 'region' ? '#3370ff' : '#fff', color: viz === 'region' ? '#fff' : '#333' }}>区域地图</button>
        {viz === 'region' && (
          <>
            <span style={{ fontSize: 12, color: '#8a919f' }}>行政区：</span>
            <select value={regionFieldSel} onChange={(e) => setRegionFieldId(e.target.value)} style={{ ...selStyle }}>
              {regionTextFields.length ? regionTextFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">（无文本/单选字段）</option>}
            </select>
            <span style={{ fontSize: 12, color: '#8a919f' }}>指标：</span>
            <select value={regionMetricSel} onChange={(e) => setRegionMetricId(e.target.value)} style={{ ...selStyle }}>
              <option value="">（计数）</option>
              {regionNumFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <select value={regionMode} onChange={(e) => setRegionMode(e.target.value as RegionAggMode)} style={{ ...selStyle }}>
              <option value="count">计数</option><option value="sum">求和</option><option value="avg">平均</option><option value="max">最大</option><option value="min">最小</option>
            </select>
          </>
        )}
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#8a919f' }}>
          {dataSet ? `${dataSet.name} · ${dataSet.rowIds.length} 条记录` : loading ? '加载数据中…' : '无数据'}
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>加载中…</div>}
          {!loading && dataSet && viz === 'scatter' && (
            <MapPanel dataSet={dataSet} coordField={coordField} layer={layer} onLayerChange={setLayer} selection={selection}
              onSelectRows={(rows) => setSelection({ rowIds: rows })} onCoordFieldChange={() => {}} />
          )}
          {!loading && dataSet && viz === 'region' && (
            <RegionMapPanel dataSet={dataSet} regionFieldId={regionFieldSel} metricFieldId={regionMetricSel} mode={regionMode} />
          )}
          {!loading && !dataSet && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>请先在配置模式选择表和坐标字段</div>}
        </div>
      </div>
      {dataSet && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', fontSize: 12 }}>
          <span style={{ marginRight: 12 }}>记录: {dataSet.rowIds.length}</span>
          <span style={{ marginRight: 12 }}>字段: {dataSet.fields.length}</span>
          {viz === 'scatter' ? <span>坐标字段: {coordField?.name || '（未识别）'}</span> : <span>行政区字段: {regionTextFields.find((f) => f.id === regionFieldSel)?.name || '（未识别）'}</span>}
        </div>
      )}
    </main>
  );
}
