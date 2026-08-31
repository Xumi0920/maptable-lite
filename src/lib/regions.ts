// 区域地图聚合逻辑：按行政区字段聚合统计
// 输入：DataSet + 行政区字段 + 指标字段（可选） → 每个行政区的 计数/求和/平均
// 输出：RegionAgg[]（regionName + 聚合值），用于区域地图分级设色

import type { DataSet, FieldDef } from '../types';
import { displayValue, fieldValue } from './utils';
import { normalizeRegionName } from './geo';

export type RegionAggMode = 'count' | 'sum' | 'avg' | 'max' | 'min';

export interface RegionAgg {
  name: string;         // 行政区名（如 北京 / 福建）
  count: number;        // 记录数
  value: number;        // 指标聚合值（未选指标时 = count）
}

/** 按行政区字段分组，对指标字段做聚合 */
export function aggregateByRegion(
  dataSet: DataSet,
  regionField: FieldDef,
  metricField?: FieldDef,
  mode: RegionAggMode = 'count',
): RegionAgg[] {
  const map = new Map<string, { count: number; sum: number; max: number; min: number; vals: number[] }>();

  for (const id of dataSet.rowIds) {
    const row = dataSet.rows[id] || {};
    // 行政区值
    const rawRegion = fieldValue(row, regionField);
    if (rawRegion == null || rawRegion === '') continue;
    const regionName = displayValue(regionField, rawRegion).trim();
    if (!regionName) continue;

    let entry = map.get(regionName);
    if (!entry) {
      entry = { count: 0, sum: 0, max: -Infinity, min: Infinity, vals: [] };
      map.set(regionName, entry);
    }
    entry.count += 1;

    // 指标值
    if (metricField) {
      const rawVal = fieldValue(row, metricField);
      const n = Number(rawVal);
      if (rawVal != null && rawVal !== '' && isFinite(n)) {
        entry.sum += n;
        entry.vals.push(n);
        if (n > entry.max) entry.max = n;
        if (n < entry.min) entry.min = n;
      }
    }
  }

  const result: RegionAgg[] = [];
  for (const [name, e] of map) {
    let value = e.count;
    if (metricField) {
      switch (mode) {
        case 'sum': value = e.sum; break;
        case 'avg': value = e.vals.length ? e.sum / e.vals.length : 0; break;
        case 'max': value = e.max === -Infinity ? 0 : e.max; break;
        case 'min': value = e.min === Infinity ? 0 : e.min; break;
        default: value = e.count;
      }
    }
    result.push({ name, count: e.count, value });
  }

  // 按 value 降序
  return result.sort((a, b) => b.value - a.value);
}

/** 自动识别行政区字段（优先省，再市/地区；省>市，因为区域地图用省界 GeoJSON 着色） */
export function findRegionField(dataSet: DataSet): FieldDef | undefined {
  const fields = dataSet.fields;
  // 1. 优先：省 / province（能匹配省界 GeoJSON，否则城市数据匹配不到省界）
  const prov = fields.find((f) =>
    /省份|省市|省名|省$|province|province_name|province_name/i.test(f.name) ||
    /^省$/i.test(f.name)
  );
  if (prov) return prov;
  // 2. 其次：城市 / city
  const city = fields.find((f) =>
    /城市|城市名|市$|city|city_name|municipality/i.test(f.name)
  );
  if (city) return city;
  // 3. 地区 / region / district / area / state
  const region = fields.find((f) =>
    /地区|行政|区域|区县|区$|region|district|area|state|country/i.test(f.name)
  );
  if (region) return region;
  // 4. 最后：select 类型字段（通常行政区是单选）
  return fields.find((f) => f.type === 'select');
}

/** 自动识别城市字段（下钻到省后用城市聚合；优先"城市"类名字） */
export function findCityField(dataSet: DataSet): FieldDef | undefined {
  const fields = dataSet.fields;
  const city = fields.find((f) =>
    /城市|城市名|市$|city|city_name|municipality/i.test(f.name)
  );
  if (city) return city;
  // 兜底：非"省份"字段的文本/单选字段（含 dept/prefecture 等）
  const provId = findRegionField(dataSet)?.id;
  return fields.find((f) => f.id !== provId && (f.type === 'text' || f.type === 'select'));
}

/** 自动识别指标字段（优先 number 类型） */
export function findMetricField(dataSet: DataSet): FieldDef | undefined {
  return dataSet.fields.find((f) => f.type === 'number');
}

/** 某行政区域的所有记录行（明细弹窗用）：按 regionField 值模糊匹配区域名，返回记录名 + 指标值 */
export interface RegionRowDetail {
  rowId: string;
  name: string;
  value: number | null;
}
export function rowsMatchingRegion(
  dataSet: DataSet,
  regionField: FieldDef | undefined,
  nameField: FieldDef | undefined,
  metricField: FieldDef | undefined,
  regionName: string,
): RegionRowDetail[] {
  if (!regionField || !regionName) return [];
  const regionNorm = normalizeRegionName(regionName);
  return dataSet.rowIds.map((id) => {
    const row = dataSet.rows[id];
    const regionVal = String(fieldValue(row, regionField) ?? '');
    if (normalizeRegionName(regionVal) !== regionNorm) return null;
    const nameText = nameField ? String(fieldValue(row, nameField) ?? '') : id;
    const m = metricField ? Number(fieldValue(row, metricField)) : NaN;
    return { rowId: id, name: nameText, value: isFinite(m) ? m : null } as RegionRowDetail | null;
  }).filter(Boolean) as RegionRowDetail[];
}
