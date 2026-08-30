// 飞书多维表格仪表盘插件主组件
// 配置模式：getTableList 列所有表→选表→读该表字段→选坐标字段→dashboard.saveConfig
// 展示模式：用配置保存的 tableId，getTableById 读该表字段+记录→DataSet→渲染高德地图
//
// 关键：配置模式下 getActiveTable() 会抛 "table not found error"（配置面板不绑定到具体表视图），
// 所以配置模式和展示模式都用"显式 tableId"（getTableList/getTableById），不依赖 getActiveTable。

import { useEffect, useMemo, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { useTheme, useConfig } from './hooks';
import { dataSetFromBitable, bitableFieldToLike, type BitableFieldLike, type BitableRecordLike } from './bitableToDataSet';
import type { DataSet, LayerType, Selection, FieldDef } from '../types';
import MapPanel from '../components/MapPanel';
import '../index.css';

interface PluginConfig {
  tableId: string;         // 数据表 id
  coordFieldId: string;    // 地图坐标字段 id
  coordFieldName: string;  // 坐标字段名（展示/兜底）
}

const DEFAULT_CONFIG: PluginConfig = { tableId: '', coordFieldId: '', coordFieldName: '' };

interface TableMeta { id: string; name: string }

export default function FeishuPluginApp() {
  const { bgColor, theme } = useTheme();
  const { config, setConfig, saveConfig, setRendered, isConfig } = useConfig<PluginConfig>(DEFAULT_CONFIG);

  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [fields, setFields] = useState<BitableFieldLike[]>([]);
  const [fieldError, setFieldError] = useState('');
  const [layer, setLayer] = useState<LayerType>('scatter');
  const [selection, setSelection] = useState<Selection>({ rowIds: [] });

  const hasKey = (import.meta.env.VITE_AMAP_KEY as string) || '';

  // 拉取当前多维表格下的所有表（配置/展示都用，不依赖 getActiveTable）
  const loadTableList = useMemo(() => async () => {
    const metas = await bitable.base.getTableMetaList();
    const list: TableMeta[] = (metas || []).map((m: any) => ({ id: m.id, name: m.name }));
    setTables(list);
    return list;
  }, []);

  // 读取指定表的字段
  const loadFieldsOfTable = useMemo(() => async (tableId: string) => {
    const table = await bitable.base.getTableById(tableId);
    const fList: BitableFieldLike[] = await Promise.all(((await table.getFieldList()) || []).map((f: any) => bitableFieldToLike(f)));
    setFields(fList);
    return fList;
  }, []);

  // 读取指定表 字段+记录 → DataSet（展示模式）
  const loadData = useMemo(() => async (tableId: string) => {
    const table = await bitable.base.getTableById(tableId);
    const meta = await table.getMeta();
    const fList: BitableFieldLike[] = await Promise.all(((await table.getFieldList()) || []).map((f: any) => bitableFieldToLike(f)));
    setFields(fList);
    const recordList: BitableRecordLike[] = [];
    const list = await table.getRecordList();
    for await (const rec of list) {
      recordList.push({ recordId: rec.id, getCellByField: (fieldId: string) => rec.getCellByField(fieldId) });
    }
    const ds = await dataSetFromBitable(fList, recordList, meta.name || '飞书多维表格');
    setDataSet(ds);
    setLoading(false);
    setRendered(2500);
  }, []);

  // 首次加载表列表
  useEffect(() => {
    (async () => {
      try {
        const list = await loadTableList();
        // 展示模式：用配置中保存的 tableId 直接读数据；若无则用第一张表兜底
        const useTableId = config.tableId || list[0]?.id || '';
        if (!isConfig && useTableId) {
          setTableSelection(useTableId);
          await loadData(useTableId);
        } else if (!isConfig) {
          setLoading(false);
        }
        // 配置模式：选表后由用户交互决定，默认预选第一张表并读其字段
        if (isConfig && useTableId) {
          setTableSelection(useTableId);
          try {
            await loadFieldsOfTable(useTableId);
            setFieldError('');
          } catch (e: any) {
            setFieldError(String(e?.message || e));
          }
        }
      } catch (e: any) {
        setFieldError(String(e?.message || e));
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 配置模式：切换表 → 重读字段
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

  // 配置模式下选择坐标字段（候选：地理位置字段 + 名字含坐标的）
  const coordCandidates = useMemo(() => {
    return fields.map((f) => ({
      id: f.id,
      name: f.name,
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

        {/* 选择数据表 */}
        <div style={{ fontSize: 13, marginBottom: 6 }}>数据表：</div>
        <select
          value={tableSelection}
          onChange={(e) => onTableChange(e.target.value)}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}
        >
          {tables.length === 0 && <option value="">（加载表列表…）</option>}
          {tables.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>

        {/* 字段读取诊断 */}
        {fieldError ? (
          <div style={{ background: '#fff1f0', color: '#d4380d', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginTop: 10, wordBreak: 'break-all' }}>
            ⚠ 读取字段失败：{fieldError}
          </div>
        ) : fields.length > 0 ? (
          <div style={{ color: '#52c41a', fontSize: 12, marginTop: 10 }}>✓ 已读取 {fields.length} 个字段</div>
        ) : (
          <div style={{ color: '#8a919f', fontSize: 12, marginTop: 10 }}>正在读取字段…</div>
        )}

        {/* 选择坐标字段 */}
        <div style={{ fontSize: 13, marginTop: 12, marginBottom: 6 }}>选择要在地图上定位的「坐标字段」：</div>
        {fields.length > 0 ? (
          <select
            value={selId}
            onChange={(e) => setConfig((prev) => ({ ...prev, coordFieldId: e.target.value, coordFieldName: coordCandidates.find((c) => c.id === e.target.value)?.name || '', tableId: tableSelection }))}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}
          >
            {coordCandidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name}{c.isCoord ? '（坐标）' : ''}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            placeholder="手动输入坐标字段名（如：坐标 / 经纬度）"
            value={config.coordFieldName}
            onChange={(e) => setConfig((prev) => ({ ...prev, coordFieldName: e.target.value }))}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13, boxSizing: 'border-box' }}
          />
        )}

        <button
          onClick={() => saveConfig({ ...config, tableId: tableSelection, coordFieldId: fields.length ? selId : '', coordFieldName: fields.length ? selName : config.coordFieldName })}
          style={{ marginTop: 14, padding: '8px 20px', borderRadius: 6, border: 'none', background: '#3370ff', color: '#fff', fontSize: 13, cursor: 'pointer' }}
        >保存</button>
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
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#8a919f' }}>
          {dataSet ? `${dataSet.name} · ${dataSet.rowIds.length} 条记录` : loading ? '加载数据中…' : '无数据'}
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>加载中…</div>}
          {!loading && dataSet && (
            <MapPanel dataSet={dataSet} coordField={coordField} layer={layer} onLayerChange={setLayer} selection={selection}
              onSelectRows={(rows) => setSelection({ rowIds: rows })} onCoordFieldChange={() => {}} />
          )}
          {!loading && !dataSet && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>请先在配置模式选择表和坐标字段</div>}
        </div>
      </div>
      {dataSet && (
        <div style={{ padding: '8px 14px', borderTop: '1px solid rgba(0,0,0,0.06)', fontSize: 12 }}>
          <span style={{ marginRight: 12 }}>记录: {dataSet.rowIds.length}</span>
          <span style={{ marginRight: 12 }}>字段: {dataSet.fields.length}</span>
          <span>坐标字段: {coordField?.name || '（未识别）'}</span>
        </div>
      )}
    </main>
  );
}
