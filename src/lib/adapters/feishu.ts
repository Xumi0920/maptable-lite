// 飞书多维表格 (Bitable) 适配器 —— 数据源转换层
// 职责：飞书多维表格的 字段/记录 格式 ↔ 本项目的 DataSet 格式双向转换
// 字段类型映射：飞书 field.type(int) ↔ FieldType
//   1 文本 → text    2 数字 → number   3 单选 → select
//   5 日期(毫秒) → date   22 地理位置("lng,lat") → coordinate
// 本文件含纯转换 + 飞书开放平台 API 请求封装（tenant_access_token 鉴权）。
// 网络请求用原生 fetch，无第三方依赖。

import type { DataSet, FieldDef, FieldType, Row, RowMap } from '../../types';
import { uid } from '../utils';

const api = 'https://open.feishu.cn/open-apis';

/* ---------- 字段类型映射 ---------- */

/** 飞书 field.type → 本项目 FieldType */
export function feishuTypeToFieldType(type: number): FieldType {
  switch (type) {
    case 1: return 'text';                 // 文本
    case 2: return 'number';               // 数字
    case 3: return 'select';               // 单选
    case 5: return 'date';                 // 日期（毫秒时间戳）
    case 22: return 'coordinate';          // 地理位置（"经度,纬度"）
    default: return 'text';
  }
}

/** 本项目 FieldType → 飞书 field.type */
export function fieldTypeToFeishuType(type: FieldType): number {
  switch (type) {
    case 'number': return 2;
    case 'select': return 3;
    case 'date': return 5;
    case 'coordinate': return 22;
    case 'text':
    default: return 1;
  }
}

/** 从飞书字段定义转 FieldDef */
function feishuFieldToFieldDef(f: any, index: number): FieldDef {
  const id = uid('fld');
  const type = feishuTypeToFieldType(Number(f.type));
  const def: FieldDef = { id, name: f.field_name || `字段${index + 1}`, type };
  if (type === 'select') {
    // 单选字段选项
    const opts: string[] = ((f.property as any)?.options || []).map((o: any) => o.name).filter(Boolean);
    if (opts.length) def.options = opts;
  }
  return def;
}

/** 飞书记录字段值 → 本项目简单值 */
function feishuValueToLocal(fieldType: FieldType, v: unknown): unknown {
  if (v == null) return '';
  switch (fieldType) {
    case 'number': {
      const n = typeof v === 'object' ? (v as any)?.number ?? (v as any)?.value : v;
      const num = Number(n);
      return isNaN(num) ? '' : num;
    }
    case 'select': {
      // 单选可能是 { text } 或字符串
      if (typeof v === 'object' && v !== null) return (v as any)?.text ?? '';
      return String(v);
    }
    case 'date': {
      // 日期可能是毫秒时间戳或 { timestamp }
      let ts: number | string | undefined;
      if (typeof v === 'object' && v !== null) ts = (v as any)?.timestamp;
      else ts = v as number | string;
      const t = Number(ts);
      if (isNaN(t) || t === 0) return '';
      const d = new Date(t);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    case 'coordinate': {
      // 地理位置可能是 "lng,lat" 或字符串
      return String(v);
    }
    default:
      // 文本可能是纯字符串或 { text }
      if (typeof v === 'object' && v !== null) return (v as any)?.text ?? (v as any)?.value ?? '';
      return String(v);
  }
}

/** 本项目简单值 → 飞书记录字段值 */
function localValueToFeishu(fieldType: FieldType, v: unknown): unknown {
  if (v == null || v === '') return null;
  switch (fieldType) {
    case 'number': return Number(v);
    case 'date': {
      const d = new Date(String(v));
      if (isNaN(d.getTime())) return null;
      return d.getTime();
    }
    case 'coordinate': return String(v);  // "lng,lat"
    case 'select': return String(v);
    default: return String(v);
  }
}

/* ---------- 拉取：飞书多维表格 → DataSet ---------- */

export interface FeishuTableRef {
  appToken: string;    // 多维表格 app_token
  tableId: string;     // 数据表 table_id
}

/**
 * 从飞书多维表格拉取字段 + 记录 → DataSet
 * @param token tenant_access_token
 * @param ref 多维表格 app_token + table_id
 * @param name 数据集名称
 */
export async function pullFromFeishu(token: string, ref: FeishuTableRef, name = '飞书多维表格'): Promise<DataSet> {
  // 1. 拉取字段列表
  const fieldsData = await feishuGet(token, `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/fields`);
  const fieldItems: any[] = fieldsData?.items || [];
  if (!fieldItems.length) throw new Error('该数据表没有可用字段');

  const fields: FieldDef[] = fieldItems.map((f, i) => feishuFieldToFieldDef(f, i));

  // 2. 拉取记录（分页，最多 5000 条，每页 500）
  const records: any[] = [];
  let pageToken: string | undefined;
  do {
    const params: Record<string, string> = { page_size: '500' };
    if (pageToken) params.page_token = pageToken;
    const rd = await feishuGet(token, `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/records`, params);
    records.push(...(rd?.items || []));
    pageToken = rd?.has_more ? (rd?.page_token as string) : undefined;
  } while (pageToken && records.length < 5000);

  // 3. 转 DataSet
  const rows: RowMap = {};
  const rowIds: string[] = [];
  for (const rec of records) {
    const id = rec.record_id || uid('row');
    const row: Row = {};
    const recFields: Record<string, unknown> = rec.fields || {};
    for (let i = 0; i < fieldItems.length; i++) {
      const f = fieldItems[i];
      const def = fields[i];
      const raw = recFields[f.field_name];
      row[def.id] = feishuValueToLocal(def.type, raw);
    }
    rows[id] = row;
    rowIds.push(id);
  }

  return { name, fields, rows, rowIds, geometry: [] };
}

/* ---------- 推送：DataSet → 飞书多维表格 ---------- */

/**
 * 把 DataSet 推送(增改)到飞书多维表格。
 * rowId 若以飞书 record_id 开头会按 record 更新；否则按字段内容匹配，找不到则新增。
 * @param token tenant_access_token
 * @param ref 多维表格 app_token + table_id
 * @param ds 本地数据集
 * @param matchFieldId 用于匹配已有记录的唯一字段（默认第一个文本字段）
 * @returns 操作统计
 */
export async function pushToFeishu(token: string, ref: FeishuTableRef, ds: DataSet, matchFieldId?: string): Promise<{ created: number; updated: number; skipped: number }> {
  // 1. 拉取现有记录（用于匹配）
  const existing = await feishuGet(token, `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/records`, { page_size: '500' });
  const existingItems: any[] = existing?.items || [];
  const existingFieldItems: any[] = (await feishuGet(token, `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/fields`))?.items || [];

  // 建立 字段名 → 飞书字段 type 映射（推送时按值格式）
  const typeByName = new Map(existingFieldItems.map((f: any) => [f.field_name, Number(f.type)]));

  // 2. 匹配字段：本地字段名 → 飞书字段名（同名优先）
  const matchField = ds.fields.find((f) => f.id === matchFieldId) || ds.fields.find((f) => f.type === 'text');

  // 3. 逐条推送（单条 create/update）
  let created = 0, updated = 0, skipped = 0;
  for (const id of ds.rowIds) {
    const row = ds.rows[id] || {};
    const fieldsPayload: Record<string, unknown> = {};
    for (const f of ds.fields) {
      const v = row[f.id];
      if (v == null || v === '') continue;
      // 用目标表里的字段类型决定值格式（优先），否则用本地类型
      const targetType = typeByName.get(f.name) ?? fieldTypeToFeishuType(f.type);
      const targetFieldType = feishuTypeToFieldType(targetType);
      fieldsPayload[f.name] = localValueToFeishu(targetFieldType, v);
    }
    if (!Object.keys(fieldsPayload).length) { skipped++; continue; }

    // 尝试匹配已存在记录（按 name 字段）
    const matchVal = matchField ? row[matchField.id] : undefined;
    let targetRec: string | undefined;
    if (matchVal != null && matchVal !== '' && matchField) {
      targetRec = existingItems.find((r: any) => {
        const rv = r.fields?.[matchField.name];
        // 文本可能 {text}
        const rvText = typeof rv === 'object' && rv !== null ? (rv as any)?.text : rv;
        return String(rvText) === String(matchVal);
      })?.record_id;
    }

    if (targetRec) {
      await feishuRequest(token, 'PUT', `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/records/${targetRec}`, { fields: fieldsPayload });
      updated++;
    } else {
      await feishuRequest(token, 'POST', `/bitable/v1/apps/${ref.appToken}/tables/${ref.tableId}/records`, { fields: fieldsPayload });
      created++;
    }
  }
  return { created, updated, skipped };
}

/* ---------- 飞书 API 请求封装 ---------- */

/** 获取 tenant_access_token（应用鉴权） */
export async function getTenantToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch(`${api}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const obj = await res.json();
  if (!obj?.tenant_access_token) throw new Error(`获取 tenant_access_token 失败: ${obj?.msg || obj?.code || '未知错误'}`);
  return obj.tenant_access_token as string;
}

interface FeishuResp {
  code?: number;
  msg?: string;
  data?: any;
}

async function feishuRequest(token: string, method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${api}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const obj = (await res.json()) as FeishuResp;
  if (obj.code && obj.code !== 0) throw new Error(`飞书 API 错误 ${obj.code}: ${obj.msg}`);
  return obj.data;
}

async function feishuGet(token: string, path: string, params?: Record<string, string>): Promise<any> {
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  return feishuRequest(token, 'GET', path + qs);
}

/* ---------- 便捷：从 DataSet 推断飞书字段创建 payload（可选，用于建表） ---------- */

/** 生成飞书"新增字段"的 payload 列表（用该数据集建一张新表时使用） */
export function fieldsToFeishuCreatePayload(ds: DataSet): Array<{ field_name: string; type: number; property?: any }> {
  return ds.fields.map((f) => {
    const type = fieldTypeToFeishuType(f.type);
    const payload: any = { field_name: f.name, type };
    if (f.type === 'select' && f.options?.length) {
      payload.property = { options: f.options.map((opt) => ({ name: opt })) };
    }
    return payload;
  });
}
