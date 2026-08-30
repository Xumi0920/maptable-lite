// 通用工具函数：坐标解析、字段值读取、筛选排序、id 生成

import type { FieldDef, FilterDef, Row, RowMap, SortDef, GeoFeature } from '../types';

/** 生成短唯一 id */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 解析一个字段里的坐标。
 * 支持: "lng,lat" / "lng,lat"（空格分隔） / 数组 [lng,lat] / 对象 {lng,lat} / {longitude,latitude}
 * 返回高德 GCJ-02 [lng, lat]，非法返回 null。
 */
export function parseCoordinate(value: unknown): [number, number] | null {
  if (value == null) return null;
  if (Array.isArray(value)) {
    if (value.length >= 2 && isFinite(Number(value[0])) && isFinite(Number(value[1]))) {
      return [Number(value[0]), Number(value[1])];
    }
    return null;
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const lng = Number(v.lng ?? v.longitude ?? v.lon ?? v.x);
    const lat = Number(v.lat ?? v.latitude ?? v.y);
    if (isFinite(lng) && isFinite(lat)) return [lng, lat];
    return null;
  }
  const s = String(value).trim();
  if (!s) return null;
  // 支持 "lng,lat" 或 "lng lat"
  const m = s.match(/^\s*(-?\d+(\.\d+)?)\s*[,，]\s*(-?\d+(\.\d+)?)\s*$/)
    || s.match(/^\s*(-?\d+(\.\d+)?)\s+(-?\d+(\.\d+)?)\s*$/);
  if (m) {
    const lng = parseFloat(m[1]);
    const lat = parseFloat(m[3]);
    if (isFinite(lng) && isFinite(lat)) return [lng, lat];
  }
  return null;
}

/** 从行记录里读取字段的显示值 */
export function fieldValue(row: Row, field: FieldDef): unknown {
  return row[field.id];
}

/** 从行里读取坐标（若该字段是 coordinate 类型） */
export function rowCoordinate(row: Row, field: FieldDef): [number, number] | null {
  if (field.type !== 'coordinate') return null;
  return parseCoordinate(row[field.id]);
}

/** 统一取值（数值化）用于排序/比较 */
export function numValue(field: FieldDef, v: unknown): number {
  if (v == null || v === '') return NaN;
  switch (field.type) {
    case 'number':
      return Number(v);
    case 'date': {
      const t = new Date(String(v)).getTime();
      return isNaN(t) ? NaN : t;
    }
    default: {
      const n = Number(v);
      return isNaN(n) ? NaN : n;
    }
  }
}

/** 字符串化用于展示 */
export function displayValue(field: FieldDef, v: unknown): string {
  if (v == null || v === '') return '';
  if (field.type === 'date') {
    const d = new Date(String(v));
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  return String(v);
}

function testFilter(row: Row, field: FieldDef, f: FilterDef): boolean {
  const v = fieldValue(row, field);
  if (field.type === 'number' || field.type === 'date') {
    const n = numValue(field, v);
    const t = numValue(field, f.value);
    switch (f.operator) {
      case 'eq': return n === t;
      case 'neq': return n !== t;
      case 'gt': return n > t;
      case 'lt': return n < t;
      case 'gte': return n >= t;
      case 'lte': return n <= t;
      case 'is_between': return n >= t && n <= numValue(field, f.valueMax);
      default: return true;
    }
  }
  // 文本 / select / coordinate
  const sv = displayValue(field, v).toLowerCase();
  const svRaw = String(v ?? '').toLowerCase();
  switch (f.operator) {
    case 'eq': return svRaw === String(f.value ?? '').toLowerCase() || sv === String(f.value ?? '').toLowerCase();
    case 'neq': return svRaw !== String(f.value ?? '').toLowerCase();
    case 'contains': return sv.includes(String(f.value ?? '').toLowerCase());
    default: return true;
  }
}

/** 应用筛选并返回通过的行 id 列表（保持原始顺序） */
export function applyFilters(
  rowIds: string[], rows: RowMap, fields: FieldDef[], filters: FilterDef[],
): string[] {
  if (!filters || filters.length === 0) return rowIds;
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  return rowIds.filter((id) => {
    const row = rows[id];
    if (!row) return false;
    return filters.every((f) => {
      const field = fieldMap.get(f.fieldId);
      if (!field) return true;
      return testFilter(row, field, f);
    });
  });
}

/** 应用排序，返回新的行 id 顺序 */
export function applySorts(
  rowIds: string[], rows: RowMap, fields: FieldDef[], sorts: SortDef[],
): string[] {
  if (!sorts || sorts.length === 0) return rowIds;
  const fieldMap = new Map(fields.map((f) => [f.id, f]));
  return [...rowIds].sort((a, b) => {
    const ra = rows[a];
    const rb = rows[b];
    if (!ra || !rb) return 0;
    for (const s of sorts) {
      const field = fieldMap.get(s.fieldId);
      if (!field) continue;
      const na = numValue(field, ra[s.fieldId]);
      const nb = numValue(field, rb[s.fieldId]);
      let cmp = 0;
      if (isNaN(na) && isNaN(nb)) cmp = 0;
      else if (isNaN(na)) cmp = 1;
      else if (isNaN(nb)) cmp = -1;
      else cmp = na - nb;
      if (cmp !== 0) return s.mode === 'asc' ? cmp : -cmp;
    }
    return 0;
  });
}

/** 从行的坐标字段提取 GeoFeature 列表 */
export function buildFeatures(
  rowIds: string[], rows: RowMap, fields: FieldDef[],
): GeoFeature[] {
  const result: GeoFeature[] = [];
  for (const id of rowIds) {
    const row = rows[id];
    if (!row) continue;
    for (const field of fields) {
      if (field.type !== 'coordinate') continue;
      const v = row[field.id];
      if (v == null || v === '') continue;
      const parsed = parseCoordinate(v);
      if (parsed) {
        result.push({ id, geometry: 'point', coordinates: parsed });
        continue;
      }
      // 尝试几何类型：line/polygon 可能以数组形式存
      if (Array.isArray(v) && v.length > 0) {
        const arr = v as unknown[];
        // 判断是否坐标数组
        const first = parseCoordinate(arr[0]);
        if (first) {
          const coords = arr.map((c) => parseCoordinate(c)).filter((c): c is [number, number] => !!c);
          if (coords.length >= 2) {
            const geometry = field.name.toLowerCase().includes('polygon') || arr.length >= 3 ? 'polygon' : 'line';
            result.push({ id, geometry, coordinates: coords });
          }
        }
      }
    }
  }
  return result;
}

/** 计算边界框（用于 fitView） */
export function bboxOf(features: GeoFeature[]): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const visit = (c: unknown) => {
    if (Array.isArray(c)) {
      if (c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
        minLng = Math.min(minLng, c[0]);
        minLat = Math.min(minLat, c[1]);
        maxLng = Math.max(maxLng, c[0]);
        maxLat = Math.max(maxLat, c[1]);
      } else {
        c.forEach(visit);
      }
    }
  };
  for (const f of features) visit(f.coordinates);
  if (!isFinite(minLng)) return null;
  return [[minLng, minLat], [maxLng, maxLat]];
}

/** 读取行内任意坐标字段解析，不限定 coordinate 类型（宽松） */
export function anyCoordinate(row: Row, fields: FieldDef[]): [number, number] | null {
  for (const f of fields) {
    const c = parseCoordinate(row[f.id]);
    if (c) return c;
  }
  return null;
}
