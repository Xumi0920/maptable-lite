// 字段管理抽屉：新增/删除字段、切换可见性、设置地图坐标字段

import { useState } from 'react';
import type { DataSet, FieldDef } from '../../types';

/** 字段类型可选值（供新增字段下拉 & 字段列表展示类型名） */
export const FIELD_TYPE_OPTIONS: Array<{ v: FieldDef['type']; label: string }> = [
  { v: 'text', label: '文本' },
  { v: 'number', label: '数值' },
  { v: 'date', label: '日期' },
  { v: 'coordinate', label: '坐标' },
  { v: 'select', label: '单选' },
];

export interface FieldsDrawerProps {
  dataSet: DataSet;
  config: { visibleFieldIds: string[] };
  onAddField: (name: string, type: FieldDef['type']) => void;
  onDeleteField: (fieldId: string) => void;
  onToggleVisible: (fieldId: string) => void;
  onChangeCoordField: (fieldId: string) => void;
  onClose: () => void;
}

export default function FieldsDrawer({ dataSet, config, onAddField, onDeleteField, onToggleVisible, onChangeCoordField, onClose }: FieldsDrawerProps) {
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
