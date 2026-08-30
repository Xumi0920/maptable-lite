// 飞书多维表格仪表盘插件主组件
// 配置模式：读当前表字段，选地图坐标字段（地理位置类）→ dashboard.saveConfig
// 展示模式：读当前表字段+记录 → DataSet → 渲染高德地图（复用 MapPanel）+ 统计 + 表格
//
// 依赖注入：此文件 import MapPanel / dataSetFromBitable / useTheme / useConfig。
// 在高德 key 未配置时降级提示（同主应用）。

import { useEffect, useMemo, useState } from 'react';
import { bitable } from '@lark-base-open/js-sdk';
import { useTheme, useConfig } from './hooks';
import { dataSetFromBitable, bitableFieldToLike, type BitableFieldLike, type BitableRecordLike } from './bitableToDataSet';
import type { DataSet, LayerType, Selection, FieldDef } from '../types';
import MapPanel from '../components/MapPanel';
import '../index.css';

interface PluginConfig {
  coordFieldId: string;    // 地图坐标字段（bitable field id / name）
  coordFieldName: string;  // 展示用
  tableId: string;
}

const DEFAULT_CONFIG: PluginConfig = { coordFieldId: '', coordFieldName: '', tableId: '' };

export default function FeishuPluginApp() {
  const { bgColor, theme } = useTheme();
  const { config, setConfig, saveConfig, setRendered, isConfig } = useConfig<PluginConfig>(DEFAULT_CONFIG);

  const [dataSet, setDataSet] = useState<DataSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [fields, setFields] = useState<BitableFieldLike[]>([]);
  const [tableId, setTableId] = useState('');
  const [layer, setLayer] = useState<LayerType>('scatter');
  const [selection, setSelection] = useState<Selection>({ rowIds: [] });

  const hasKey = (import.meta.env.VITE_AMAP_KEY as string) || '';

  // 读取当前数据表字段 + 记录（展示模式）
  const loadData = useMemo(() => async () => {
    const table = await bitable.base.getActiveTable();
    const meta = await table.getMeta();
    setTableId(meta.id);
    const fList: BitableFieldLike[] = await Promise.all(((await table.getFieldList()) || []).map((f: any) => bitableFieldToLike(f)));
    setFields(fList);
    // IRecordList 可迭代但非数组，用 for...of 遍历
    const recordList: BitableRecordLike[] = [];
    const list = await table.getRecordList();
    for await (const rec of list) {
      recordList.push({
        recordId: rec.id,
        getCellByField: (fieldId: string) => rec.getCellByField(fieldId),
      });
    }
    const ds = await dataSetFromBitable(fList, recordList, meta.name || '飞书多维表格');
    setDataSet(ds);
    setLoading(false);
    setRendered(2500);
  }, []);

  useEffect(() => {
    if (!isConfig) {
      loadData();
    } else {
      // 配置模式：只读字段，用于选坐标字段
      (async () => {
        try {
          const table = await bitable.base.getActiveTable();
          const fList: BitableFieldLike[] = await Promise.all(((await table.getFieldList()) || []).map((f: any) => bitableFieldToLike(f)));
          setFields(fList);
          setLoading(false);
        } catch (e) {
          setLoading(false);
        }
      })();
    }
  }, [isConfig]);

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
        <div style={{ fontSize: 13, marginBottom: 8 }}>选择要在地图上定位的「坐标字段」：</div>
        <select
          value={selId}
          onChange={(e) => setConfig((prev) => ({ ...prev, coordFieldId: e.target.value, coordFieldName: coordCandidates.find((c) => c.id === e.target.value)?.name || '', tableId }))}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 6, border: '1px solid #ccc', fontSize: 13 }}
        >
          {coordCandidates.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.isCoord ? '（坐标）' : ''}</option>
          ))}
        </select>
        <button
          onClick={() => { saveConfig({ ...config, coordFieldId: selId, coordFieldName: selName, tableId }); }}
          style={{ marginTop: 14, padding: '8px 20px', borderRadius: 6, border: 'none', background: '#3370ff', color: '#fff', fontSize: 13, cursor: 'pointer' }}
        >保存</button>
        <div style={{ fontSize: 11, color: theme === 'dark' ? '#8a919f' : '#8a919f', marginTop: 12 }}>
          提示：坐标字段应为「地理位置」类型（存经纬度，如 116.40,39.90）。配置保存后，组件将在地图上渲染该表数据。
        </div>
      </main>
    );
  }

  // 展示模式
  return (
    <main style={{ backgroundColor: bgColor, minHeight: '100vh', display: 'flex', flexDirection: 'column', color: theme === 'dark' ? '#e5e6eb' : '#1f2329' }}>
      {!hasKey && (
        <div style={{ padding: 12, background: '#fff7e6', color: '#d48806', fontSize: 13 }}>⚠ 未配置高德地图 Key（VITE_AMAP_KEY），地图无法加载。请在部署环境变量中配置。</div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <div style={{ textAlign: 'center', padding: '6px 0', fontSize: 12, color: '#8a919f' }}>
          {dataSet ? `${dataSet.name} · ${dataSet.rowIds.length} 条记录` : loading ? '加载数据中…' : '无数据'}
        </div>
        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>加载中…</div>}
          {!loading && dataSet && (
            <MapPanel
              dataSet={dataSet}
              coordField={coordField}
              layer={layer}
              onLayerChange={setLayer}
              selection={selection}
              onSelectRows={(rows) => setSelection({ rowIds: rows })}
              onCoordFieldChange={() => {}}
            />
          )}
          {!loading && !dataSet && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8a919f' }}>当前表没有可显示的数据</div>}
        </div>
      </div>

      {/* 字段统计（迷你） */}
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
