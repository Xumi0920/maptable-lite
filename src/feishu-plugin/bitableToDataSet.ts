// bitable SDK 数据 → 本项目 DataSet 转换
// 输入：飞书 SDK 的 table.getFieldList() + table.getRecordList() 结果
// 输出：DataSet（字段类型映射 + 记录值转换）

import type { DataSet, FieldDef, Row, RowMap } from '../types';
import { uid } from '../lib/utils';
import { feishuTypeToFieldType } from '../lib/adapters/feishu';

// 飞书 SDK FieldType 枚举值（Text=1, Number=2, SingleSelect=3, DateTime=5, Location=22 等）
// 与 bitable server API 的 type int 一致，故复用 feishuTypeToFieldType 的映射。
// 但为确保健壮，这里也接受 SDK 的枚举字符串。

export interface BitableFieldLike {
  id: string;
  name: string;
  type: number | string;
  options?: unknown;
}

export interface BitableRecordLike {
  recordId: string;
  getCellByField: (fieldId: string) => Promise<{ getValue: () => Promise<unknown> }>;
}

/**
 * 把 SDK 的 IField 对象转成同步结构 { id, name, type }。
 * 兼容两种形态：SDK 有的字段对象 name/type 是【异步方法】getName()/getType()（非属性），
 * 有的版本直接是同步属性 f.name/f.type。这里属性优先，方法兜底。
 * 直接读 f.name/f.type（当是异步方法时）会得到 undefined/函数，导致下拉为空。必须兼容。
 */
export async function bitableFieldToLike(f: any): Promise<BitableFieldLike> {
  let id = f.id;
  let name = f.name;
  let type: number | string = f.type;

  // name：属性优先，若为函数或无值则尝试异步方法
  if (typeof name === 'function' || name == null) {
    try { if (typeof f.getName === 'function') name = await f.getName(); } catch { /* ignore */ }
  }
  // type：属性优先，若为函数或无值则尝试异步方法；并兼容枚举对象 {value}
  if (typeof type === 'function' || type == null) {
    try { if (typeof f.getType === 'function') type = await f.getType(); } catch { /* ignore */ }
  }
  // 枚举对象 { value } → 取 value
  if (type && typeof type === 'object') type = (type as any)?.value ?? (type as any)?.type ?? type;

  // id 兜底：无 id 用 name 当 key（展示仍可用；展示模式会重新读真实 id）
  if (id == null) id = `fld_${String(name ?? 'field')}`;

  return { id, name: name || '字段', type };
}

/** 从 bitable 字段数组转 FieldDef（含单选 options） */
export function fieldsFromBitable(fieldList: BitableFieldLike[]): FieldDef[] {
  return fieldList.map((f) => {
    const id = uid('fld');
    const type = feishuTypeToFieldType(Number(f.type));
    const def: FieldDef = { id, name: f.name || '字段', type };
    if (type === 'select') {
      // 单选选项：SDK field 可能是 { options: [{name}] } 或直接数组
      const opts: string[] = Array.isArray(f.options)
        ? f.options.map((o: any) => (typeof o === 'string' ? o : o?.name)).filter(Boolean)
        : ((f.options as any)?.options || []).map((o: any) => o?.name).filter(Boolean);
      if (opts.length) def.options = opts;
    }
    return def;
  });
}

/** 从 bitable record 提取值（异步取 cell） */
async function recordToRow(fieldList: BitableFieldLike[], fields: FieldDef[], record: BitableRecordLike): Promise<Row> {
  const row: Row = {};
  for (let i = 0; i < fieldList.length; i++) {
    const f = fieldList[i];
    const def = fields[i];
    try {
      const cell = await record.getCellByField(f.id);
      const v = await cell.getValue();
      row[def.id] = sdkValueToLocal(def.type, v);
    } catch {
      row[def.id] = '';
    }
  }
  return row;
}

/** SDK cell value → 本地简单值 */
function sdkValueToLocal(fieldType: string, v: unknown): unknown {
  if (v == null) return '';
  switch (fieldType) {
    case 'number': {
      // SDK 数字可能是 { number } 或裸值
      const n = typeof v === 'object' && v !== null ? (v as any)?.number ?? (v as any)?.value : v;
      const num = Number(n);
      return isNaN(num) ? '' : num;
    }
    case 'select': {
      const x = typeof v === 'object' && v !== null ? (v as any)?.text ?? (v as any)?.value : v;
      return typeof x === 'number' ? String(x) : String(x ?? '');
    }
    case 'date': {
      // SDK 日期可能是毫秒 { timestamp } 或裸毫秒
      let ts: number | string | undefined;
      if (typeof v === 'object' && v !== null) ts = (v as any)?.timestamp;
      else ts = v as number | string;
      const t = Number(ts);
      if (isNaN(t) || t === 0) return '';
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    case 'coordinate': {
      // SDK Location 可能是 { location: "lng,lat" } 或字符串
      if (typeof v === 'object' && v !== null) {
        const loc = (v as any)?.location ?? (v as any)?.value ?? (v as any)?.text;
        return loc ? String(loc) : '';
      }
      return String(v);
    }
    default: {
      // 文本可能 { text } 或裸字符串
      if (typeof v === 'object' && v !== null) return String((v as any)?.text ?? (v as any)?.value ?? '');
      return String(v);
    }
  }
}

/** 从 bitable 字段 + 记录数组 → DataSet 骨架（recordId 保留） */
export async function dataSetFromBitable(fieldList: BitableFieldLike[], recordList: BitableRecordLike[], name = '飞书多维表格'): Promise<DataSet> {
  const fields = fieldsFromBitable(fieldList);
  const rows: RowMap = {};
  const rowIds: string[] = [];
  for (const rec of recordList) {
    const id = rec.recordId || uid('row');
    const row = await recordToRow(fieldList, fields, rec);
    rows[id] = row;
    rowIds.push(id);
  }
  return { name, fields, rows, rowIds, geometry: [] };
}
