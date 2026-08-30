// 视图领域类型：选中 / 筛选 / 排序 / 表格配置

/** 图表/地图选中状态 */
export interface Selection {
  rowIds: string[];     // 当前选中的行（表格高亮 + 地图高亮）
}

/** 筛选条件 */
export interface FilterDef {
  fieldId: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'is_between';
  value?: unknown;
  valueMax?: unknown;
}

/** 排序 */
export interface SortDef {
  fieldId: string;
  mode: 'asc' | 'desc';
}

/** 表格视图配置 */
export interface TableConfig {
  filters: FilterDef[];
  sorts: SortDef[];
  visibleFieldIds: string[];
}
