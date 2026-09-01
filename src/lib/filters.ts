// 通用字段过滤管道（对齐 Maptable「筛选>添加条件」+「全局筛选器条件组」语义，lite 版）
// P1 纯函数：操作符按字段类型给；applyFilters 用 AND 组合多条件，输出过滤后的 DataSet。
// P3 树形扩展：FilterNode = 条件 | 条件组（组内 and/or 可配、组间 AND，递归任意深度）。
// 区域地图聚合、明细弹窗、表格视图都可吃同一份过滤结果（filter 驱动一切）。

import type { DataSet, FieldDef, FieldType, Row } from '../types';
import { fieldValue } from './utils';

/** 过滤操作符（按字段类型分组） */
export type FilterOp =
  | 'contains' | 'notContains' | 'equals' | 'notEquals' | 'empty' | 'notEmpty'  // 文本/单选通用
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'between'                      // 数值
  | 'on' | 'before' | 'after';                                                   // 日期

/** 单个过滤条件。value2 供 between 用 */
export interface FilterCondition {
  id: string;        // 条件唯一 id（UI 删除用）
  fieldId: string;
  op: FilterOp;
  value?: string;    // 统一用字符串承载（number/date 由判定函数转换）
  value2?: string;   // between 上界
}

/** 条件组：children 按 logic 聚合（and/or）。支持嵌套（递归） */
export interface FilterGroup {
  id: string;
  logic: 'and' | 'or';
  children: FilterNode[];
}

/** 过滤树节点 = 条件 | 条件组 */
export type FilterNode = FilterCondition | FilterGroup;

/** 类型守卫：是否条件组 */
export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return (node as FilterGroup).children !== undefined;
}

/** 操作符中文标签 */
export const OP_LABEL: Record<FilterOp, string> = {
  contains: '包含', notContains: '不包含', equals: '等于', notEquals: '不等于',
  empty: '为空', notEmpty: '不为空',
  eq: '等于', neq: '不等于', gt: '大于', lt: '小于', gte: '≥', lte: '≤', between: '介于',
  on: '等于', before: '早于', after: '晚于',
};

/** 某字段类型可用的操作符（Maptable 语义：文本用包含系，数值用比较系，日期用早晚系） */
export function opsForField(type: FieldType): FilterOp[] {
  switch (type) {
    case 'number':
      return ['eq', 'neq', 'gt', 'lt', 'gte', 'lte', 'between', 'empty', 'notEmpty'];
    case 'date':
      return ['on', 'before', 'after', 'empty', 'notEmpty'];
    case 'select':
      return ['equals', 'notEquals', 'empty', 'notEmpty'];
    case 'coordinate':
      return ['empty', 'notEmpty'];
    default: // text
      return ['contains', 'notContains', 'equals', 'notEquals', 'empty', 'notEmpty'];
  }
}

/** 判断操作符是否需要值输入（empty/notEmpty 不需要） */
export function opNeedsValue(op: FilterOp): boolean {
  return op !== 'empty' && op !== 'notEmpty';
}

/** 单条件判定：行记录 + 字段 + 条件 → 命中与否 */
export function matchCondition(row: Row, field: FieldDef | undefined, cond: FilterCondition): boolean {
  if (!field) return true; // 字段不存在（如切换数据集后残留条件）视为放行，避免整表清空
  const raw = fieldValue(row, field);
  const op = cond.op;

  // 为空/不为空：null/undefined/空串 都算空
  if (op === 'empty') return raw == null || String(raw).trim() === '';
  if (op === 'notEmpty') return !(raw == null || String(raw).trim() === '');

  if (raw == null) return false; // 有值比较但该行为空 → 不命中

  if (field.type === 'number') {
    const n = Number(raw);
    if (!isFinite(n)) return false;
    const a = Number(cond.value);
    if (!isFinite(a)) return true; // 值没填完整时放行，避免筛选后全空
    switch (op) {
      case 'eq': return n === a;
      case 'neq': return n !== a;
      case 'gt': return n > a;
      case 'lt': return n < a;
      case 'gte': return n >= a;
      case 'lte': return n <= a;
      case 'between': {
        const b = Number(cond.value2);
        if (!isFinite(b)) return n >= a;
        return n >= Math.min(a, b) && n <= Math.max(a, b);
      }
      default: return true;
    }
  }

  if (field.type === 'date') {
    const d = String(raw).slice(0, 10); // 取 YYYY-MM-DD 做字典序比较
    const target = String(cond.value || '').slice(0, 10);
    if (!target) return true;
    switch (op) {
      case 'on': return d === target;
      case 'before': return d < target;
      case 'after': return d > target;
      default: return true;
    }
  }

  // text / select / coordinate：字符串语义
  const s = String(raw).trim();
  const q = String(cond.value ?? '').trim();
  if (field.type === 'select') {
    // 单选：精确匹配选项（不打到子串）
    switch (op) {
      case 'equals': return !q || s === q;
      case 'notEquals': return !q || s !== q;
      default: return true;
    }
  }
  switch (op) {
    case 'contains': return !q || s.includes(q);
    case 'notContains': return !q || !s.includes(q);
    case 'equals': return !q || s === q;
    case 'notEquals': return !q || s !== q;
    default: return true;
  }
}

/** 生成条件唯一 id */
export function newCondId(): string {
  return `cond_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 生成条件组唯一 id */
export function newGroupId(): string {
  return `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 递归判定一个过滤树节点：条件 → matchCondition；条件组 → children 按 logic 聚合。
 * 空组视为放行（true），避免删空后整表被清。
 */
export function matchNode(row: Row, fieldById: Map<string, FieldDef>, node: FilterNode): boolean {
  if (!isFilterGroup(node)) {
    return matchCondition(row, fieldById.get(node.fieldId), node);
  }
  if (!node.children.length) return true; // 空组放行
  if (node.logic === 'or') {
    return node.children.some((child) => matchNode(row, fieldById, child));
  }
  return node.children.every((child) => matchNode(row, fieldById, child));
}

/**
 * 应用过滤树（顶层节点间 AND 组合）到数据集，输出新 DataSet（fields/geometry 原样保留，rows 只留命中行）。
 * 空树 → 原样返回。
 */
export function applyFiltersTree(dataSet: DataSet, root: FilterNode[]): DataSet {
  const active = root.filter((n) => (isFilterGroup(n) ? n.children.length > 0 : Boolean(n.fieldId)));
  if (!active.length) return dataSet;
  const fieldById = new Map(dataSet.fields.map((f) => [f.id, f]));
  const keptRows: typeof dataSet.rows = {};
  const keptIds: string[] = [];
  for (const id of dataSet.rowIds) {
    const row = dataSet.rows[id] || {};
    if (active.every((node) => matchNode(row, fieldById, node))) {
      keptRows[id] = dataSet.rows[id];
      keptIds.push(id);
    }
  }
  return { ...dataSet, rows: keptRows, rowIds: keptIds };
}

/**
 * 应用过滤条件组（AND 组合）到数据集。扁平条件数组的旧入口，等价于 applyFiltersTree 的扁平特例。
 * 空条件组 → 原样返回。
 */
export function applyFilters(dataSet: DataSet, conditions: FilterCondition[]): DataSet {
  return applyFiltersTree(dataSet, conditions);
}

/** 条件描述文本（诊断/汇总用） */
export function describeCondition(field: FieldDef | undefined, cond: FilterCondition): string {
  const fname = field?.name || cond.fieldId;
  if (!opNeedsValue(cond.op)) return `${fname} ${OP_LABEL[cond.op]}`;
  return `${fname} ${OP_LABEL[cond.op]} ${cond.value ?? ''}${cond.op === 'between' ? ` ~ ${cond.value2 ?? ''}` : ''}`;
}

/** 过滤树描述文本（诊断/汇总用）：组用括号 + logic 连接 */
export function describeNode(fieldById: Map<string, FieldDef>, node: FilterNode): string {
  if (!isFilterGroup(node)) return describeCondition(fieldById.get(node.fieldId), node);
  const inner = node.children.map((c) => describeNode(fieldById, c)).join(node.logic === 'or' ? ' 或 ' : ' 且 ');
  return node.children.length <= 1 ? inner : `(${inner})`;
}

/** 收集过滤树中所有叶子条件（拉平，供统计/持久化用） */
export function flattenNodes(root: FilterNode[]): FilterCondition[] {
  const out: FilterCondition[] = [];
  const walk = (nodes: FilterNode[]) => {
    for (const n of nodes) {
      if (isFilterGroup(n)) walk(n.children);
      else out.push(n);
    }
  };
  walk(root);
  return out;
}
