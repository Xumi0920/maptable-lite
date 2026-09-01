// 通用字段过滤管道（对齐 Maptable「筛选>添加条件」+「全局筛选器条件组」语义，lite 版）
// P1 纯函数：操作符按字段类型给；applyFilters 用 AND 组合多条件，输出过滤后的 DataSet。
// P3 树形扩展：FilterNode = 条件 | 条件组（组内 and/or 可配、组间 AND，递归任意深度）。
// 区域地图聚合、明细弹窗、表格视图都可吃同一份过滤结果（filter 驱动一切）。

import type { DataSet, FieldDef, FieldType, FilterDef, Row } from '../types';
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
  legacyDateTime?: boolean; // v1 日期筛选兼容：按 Date.parse 时间戳而非日期字符串比较
  legacyBlank?: boolean; // v1 空查询兼容：保留 NaN/精确空串比较，而非新版“未填完放行”
  legacyNumeric?: boolean; // v1 数值单元格兼容：纯空格仍按 Number() 转为 0
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
      return ['on', 'notEquals', 'before', 'after', 'gte', 'lte', 'between', 'empty', 'notEmpty'];
    case 'select':
      return ['equals', 'notEquals', 'contains', 'notContains', 'empty', 'notEmpty'];
    case 'coordinate':
      return ['contains', 'notContains', 'equals', 'notEquals', 'empty', 'notEmpty'];
    default: // text
      return ['contains', 'notContains', 'equals', 'notEquals', 'empty', 'notEmpty'];
  }
}

/** 判断操作符是否需要值输入（empty/notEmpty 不需要） */
export function opNeedsValue(op: FilterOp): boolean {
  return op !== 'empty' && op !== 'notEmpty';
}

/** 日期归一化：日期输入保持 YYYY-MM-DD；其他合法格式按本地日期转换，与仪表盘年度聚合一致。 */
export function dateKey(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const isoDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoDate) {
    const year = Number(isoDate[1]);
    const month = Number(isoDate[2]);
    const day = Number(isoDate[3]);
    const checked = new Date(Date.UTC(year, month - 1, day));
    if (checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) return null;
    return raw;
  }
  const date = new Date(raw);
  if (isNaN(date.getTime())) return null;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** 单条件判定：行记录 + 字段 + 条件 → 命中与否 */
export function matchCondition(row: Row, field: FieldDef | undefined, cond: FilterCondition): boolean {
  if (!field) return true; // 字段不存在（如切换数据集后残留条件）视为放行，避免整表清空
  const raw = fieldValue(row, field);
  const op = cond.op;

  // v1 空查询兼容：旧数值/日期用 NaN 比较，文本类用未 trim 的精确空串比较
  if (cond.legacyBlank) {
    if (field.type === 'number' || field.type === 'date') {
      switch (op) {
        case 'neq':
        case 'notEquals': return true; // v1: 任意值（包括 NaN）!== NaN
        case 'eq':
        case 'on': return false; // v1: 任意值（包括 NaN）=== NaN 均为 false
        case 'gt':
        case 'lt':
        case 'gte':
        case 'lte':
        case 'before':
        case 'after':
        case 'between': return false;
        default: return true;
      }
    }
    const value = String(raw ?? '').toLocaleLowerCase();
    if (op === 'equals') return value === '';
    if (op === 'notEquals') return value !== '';
    if (op === 'contains') return true;
    if (op === 'notContains') return false;
  }

  // 为空/不为空：null/undefined/空串 都算空
  if (op === 'empty') return raw == null || String(raw).trim() === '';
  if (op === 'notEmpty') return !(raw == null || String(raw).trim() === '');

  // v1 数值条件完整兼容：查询值、单元格及 between 上界均沿用 numValue(number) 语义
  if (field.type === 'number' && cond.legacyNumeric) {
    const legacyNum = (value: unknown): number => value == null || value === '' ? NaN : Number(value);
    const n = legacyNum(raw);
    const a = legacyNum(cond.value);
    switch (op) {
      case 'eq': return n === a;
      case 'neq': return n !== a;
      case 'gt': return n > a;
      case 'lt': return n < a;
      case 'gte': return n >= a;
      case 'lte': return n <= a;
      case 'between': return n >= a && n <= legacyNum(cond.value2);
      default: return true;
    }
  }

  if (raw == null) {
    if (cond.legacyDateTime) return op === 'notEquals';
    return false; // 新版：有值比较但该行为空 → 不命中
  }

  if (field.type === 'number') {
    if (raw === '' || (typeof raw === 'string' && raw.trim() === '')) return false;
    const n = Number(raw);
    if (!isFinite(n)) return false;
    if (cond.value == null || String(cond.value).trim() === '') return true;
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
        if (cond.value2 == null || String(cond.value2).trim() === '') return n >= a;
        const b = Number(cond.value2);
        if (!isFinite(b)) return n >= a;
        return n >= Math.min(a, b) && n <= Math.max(a, b);
      }
      default: return true;
    }
  }

  if (field.type === 'date') {
    if (cond.legacyDateTime) {
      const d = new Date(String(raw)).getTime();
      const target = new Date(String(cond.value ?? '')).getTime();
      const upper = new Date(String(cond.value2 ?? '')).getTime();
      switch (op) {
        case 'on': return d === target;
        case 'notEquals': return d !== target;
        case 'before': return d < target;
        case 'after': return d > target;
        case 'gte': return d >= target;
        case 'lte': return d <= target;
        case 'between': return d >= target && d <= upper;
        default: return true;
      }
    }
    const d = dateKey(raw);
    const target = dateKey(cond.value);
    if (!target) return true;
    if (!d) return false;
    switch (op) {
      case 'on': return d === target;
      case 'notEquals': return d !== target;
      case 'before': return d < target;
      case 'after': return d > target;
      case 'gte': return d >= target;
      case 'lte': return d <= target;
      case 'between': {
        const upper = dateKey(cond.value2);
        if (!upper) return d >= target;
        return d >= (target < upper ? target : upper) && d <= (target < upper ? upper : target);
      }
      default: return true;
    }
  }

  // text / select / coordinate：字符串语义
  const s = String(raw).trim().toLocaleLowerCase();
  const q = String(cond.value ?? '').trim().toLocaleLowerCase();
  if (field.type === 'select') {
    switch (op) {
      case 'equals': return !q || s === q;
      case 'notEquals': return !q || s !== q;
      case 'contains': return !q || s.includes(q);
      case 'notContains': return !q || !s.includes(q);
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
  const children = node.children.filter(hasEffectiveCondition);
  if (!children.length) return true; // 空组本身放行；作为父组子节点时被忽略
  if (node.logic === 'or') {
    return children.some((child) => matchNode(row, fieldById, child));
  }
  return children.every((child) => matchNode(row, fieldById, child));
}

/** 节点是否包含至少一个有效叶子条件（递归忽略任意深度的空组）。 */
function hasEffectiveCondition(node: FilterNode): boolean {
  if (!isFilterGroup(node)) return Boolean(node.fieldId);
  return node.children.some(hasEffectiveCondition);
}

/**
 * 应用过滤树（顶层节点间 AND 组合）到数据集，输出新 DataSet（fields/geometry 原样保留，rows 只留命中行）。
 * 空树 → 原样返回。
 */
export function applyFiltersTree(dataSet: DataSet, root: FilterNode[]): DataSet {
  const active = root.filter(hasEffectiveCondition);
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

/**
 * 将 v1 表格 FilterDef[] 迁移为共享 FilterNode[]。
 * 旧实现对字段类型不支持的操作符会直接放行；这里同样跳过，避免升级后意外收紧数据。
 */
export function legacyFiltersToTree(filters: FilterDef[] | undefined, fields: FieldDef[]): FilterNode[] {
  if (!filters?.length) return [];
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const result: FilterNode[] = [];
  for (const legacy of filters) {
    const field = fieldById.get(legacy.fieldId);
    if (!field) continue;
    let op: FilterOp | undefined;
    if (field.type === 'number') {
      op = legacy.operator === 'is_between' ? 'between' :
        ['eq', 'neq', 'gt', 'lt', 'gte', 'lte'].includes(legacy.operator) ? legacy.operator as FilterOp : undefined;
    } else if (field.type === 'date') {
      op = legacy.operator === 'eq' ? 'on' :
        legacy.operator === 'neq' ? 'notEquals' :
        legacy.operator === 'gt' ? 'after' :
        legacy.operator === 'lt' ? 'before' :
        legacy.operator === 'is_between' ? 'between' :
        legacy.operator === 'gte' || legacy.operator === 'lte' ? legacy.operator : undefined;
    } else {
      op = legacy.operator === 'eq' ? 'equals' :
        legacy.operator === 'neq' ? 'notEquals' :
        legacy.operator === 'contains' ? 'contains' : undefined;
    }
    if (!op) continue;
    result.push({
      id: newCondId(),
      fieldId: legacy.fieldId,
      op,
      value: legacy.value == null ? '' : String(legacy.value),
      value2: legacy.valueMax == null ? '' : String(legacy.valueMax),
      legacyDateTime: field.type === 'date' ? true : undefined,
      legacyBlank: legacy.value == null || String(legacy.value) === '' ? true : undefined,
      legacyNumeric: field.type === 'number' ? true : undefined,
    });
  }
  return result;
}

/**
 * 升级 e57bdf3 已持久化的筛选树：按旧 TableConfig.filters 的条件签名，
 * 递归补齐后来增加的 legacy* 兼容标记。未匹配的现代条件保持不变。
 */
export function upgradeLegacyFilterTree(root: FilterNode[], legacyFilters: FilterDef[], fields: FieldDef[]): FilterNode[] {
  const migrated = legacyFiltersToTree(legacyFilters, fields);
  const signature = (condition: FilterCondition) => [condition.fieldId, condition.op, condition.value ?? '', condition.value2 ?? ''].join('\u0000');
  const legacyBySignature = new Map(
    migrated.filter((node): node is FilterCondition => !isFilterGroup(node)).map((condition) => [signature(condition), condition]),
  );
  const walk = (nodes: FilterNode[]): FilterNode[] => nodes.map((node) => {
    if (isFilterGroup(node)) return { ...node, children: walk(node.children) };
    const legacy = legacyBySignature.get(signature(node));
    if (!legacy) return node;
    return {
      ...node,
      legacyDateTime: node.legacyDateTime ?? legacy.legacyDateTime,
      legacyBlank: node.legacyBlank ?? legacy.legacyBlank,
      legacyNumeric: node.legacyNumeric ?? legacy.legacyNumeric,
    };
  });
  return walk(root);
}

/** 固定槽位筛选的切换/替换（交叉筛选用）：同一节点再次触发即移除。 */
export function toggleNamedFilter(root: FilterNode[], slotId: string, node: FilterNode | null): FilterNode[] {
  const current = root.find((item) => item.id === slotId);
  const rest = root.filter((item) => item.id !== slotId);
  if (!node || (current && JSON.stringify(current) === JSON.stringify(node))) return rest;
  return [...rest, node];
}
