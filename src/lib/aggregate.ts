// 仪表盘聚合逻辑：从 DataSet 计算统计卡片 + 图表数据
// 设计为字段类型自适应：数值字段算求和/平均/最大最小，select 字段算分组占比，
// date 字段算按年趋势，text 字段算去重数。

import type { DataSet } from '../types';
import { numValue, fieldValue, displayValue } from './utils';

/** 数值字段的统计 */
export interface NumericStat {
  fieldId: string;
  fieldName: string;
  count: number;        // 非空数值个数
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/** 单选/分组字段的分布（占比） */
export interface GroupStat {
  fieldId: string;
  fieldName: string;
  groups: Array<{ label: string; count: number; pct: number }>;
}

/** 日期字段的年度趋势 */
export interface TrendStat {
  fieldId: string;
  fieldName: string;
  years: Array<{ year: string; count: number }>;
}

/** 仪表盘整体统计结果 */
export interface DashboardStats {
  totalRows: number;
  numericStats: NumericStat[];
  groupStats: GroupStat[];
  trendStats: TrendStat[];
  // 通用文本字段去重统计（用于"非重复值"卡片）
  distinctCounts: Array<{ fieldId: string; fieldName: string; distinct: number }>;
}

/** 从 DataSet 计算仪表盘统计 */
export function computeDashboardStats(ds: DataSet): DashboardStats {
  const numericFields = ds.fields.filter((f) => f.type === 'number');
  const groupFields = ds.fields.filter((f) => f.type === 'select');
  const dateFields = ds.fields.filter((f) => f.type === 'date');
  const textFields = ds.fields.filter((f) => f.type === 'text');

  const numericStats: NumericStat[] = numericFields.map((f) => {
    let count = 0, sum = 0, min = Infinity, max = -Infinity;
    for (const id of ds.rowIds) {
      const v = numValue(f, fieldValue(ds.rows[id] || {}, f));
      if (isNaN(v)) continue;
      count++;
      sum += v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return {
      fieldId: f.id, fieldName: f.name, count,
      sum: count ? sum : 0,
      avg: count ? sum / count : 0,
      min: count ? min : 0,
      max: count ? max : 0,
    };
  });

  const groupStats: GroupStat[] = groupFields.map((f) => {
    const counts = new Map<string, number>();
    for (const id of ds.rowIds) {
      const v = displayValue(f, fieldValue(ds.rows[id] || {}, f));
      if (v === '') continue;
      counts.set(v, (counts.get(v) || 0) + 1);
    }
    const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
    const groups = [...counts.entries()]
      .map(([label, count]) => ({ label, count, pct: Math.round((count / total) * 100) }))
      .sort((a, b) => b.count - a.count);
    return { fieldId: f.id, fieldName: f.name, groups };
  });

  const trendStats: TrendStat[] = dateFields.map((f) => {
    const years = new Map<string, number>();
    for (const id of ds.rowIds) {
      const raw = fieldValue(ds.rows[id] || {}, f);
      if (raw == null || raw === '') continue;
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) continue;
      const y = String(d.getFullYear());
      years.set(y, (years.get(y) || 0) + 1);
    }
    const yr = [...years.entries()]
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => a.year.localeCompare(b.year));
    return { fieldId: f.id, fieldName: f.name, years: yr };
  });

  const distinctCounts = textFields.map((f) => {
    const set = new Set<string>();
    for (const id of ds.rowIds) {
      const v = displayValue(f, fieldValue(ds.rows[id] || {}, f));
      if (v !== '') set.add(v);
    }
    return { fieldId: f.id, fieldName: f.name, distinct: set.size };
  });

  return { totalRows: ds.rowIds.length, numericStats, groupStats, trendStats, distinctCounts };
}

/** 为柱状图取数值字段的 TOP N 行（按某数值字段降序） */
export function topRowsByField(ds: DataSet, fieldId: string, labelFieldId: string, n = 8): Array<{ label: string; value: number }> {
  const field = ds.fields.find((f) => f.id === fieldId);
  if (!field || field.type !== 'number') return [];
  const labelField = ds.fields.find((f) => f.id === labelFieldId) || ds.fields[0];
  const items = ds.rowIds.map((id) => {
    const row = ds.rows[id] || {};
    const v = numValue(field, fieldValue(row, field));
    const label = labelField ? displayValue(labelField, fieldValue(row, labelField)) : String(id);
    return { label, value: isNaN(v) ? 0 : v };
  });
  items.sort((a, b) => b.value - a.value);
  return items.slice(0, n);
}

/** 图表颜色板（与主 UI 蓝色系协调） */
export const CHART_COLORS = [
  '#2f6bff', '#7c3aed', '#06b6d4', '#16a34a', '#f59e0b',
  '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316',
];

export function colorFor(i: number): string {
  return CHART_COLORS[i % CHART_COLORS.length];
}
