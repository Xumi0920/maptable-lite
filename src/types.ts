// 数据模型与几何类型定义 —— 整个系统的类型核心

/** 字段类型 */
export type FieldType =
  | 'text'        // 文本
  | 'number'      // 数值
  | 'date'        // 日期
  | 'coordinate'  // 经纬度（核心字段，用于上图）
  | 'select';     // 单选（用于筛选/着色）

/** 几何类型（地图可渲染的图形） */
export type GeometryType = 'point' | 'line' | 'polygon';

/** 图层类型（地图可视化方式） */
export type LayerType = 'scatter' | 'cluster' | 'heatmap' | 'point' | 'line' | 'polygon';

/** 字段定义 */
export interface FieldDef {
  id: string;          // 字段唯一 id
  name: string;        // 字段名
  type: FieldType;     // 字段类型
  options?: string[];  // select 类型的选项
}

/** 单行记录 */
export type Row = Record<string, unknown>;

/** 行 id 到记录的映射 */
export type RowMap = Record<string, Row>;

/** 几何对象（坐标用高德 GCJ-02 火星坐标） */
export interface GeoFeature {
  id: string;           // 关联行 id
  geometry: GeometryType;
  coordinates: number[] | number[][];  // 点:[lng,lat]  线:[ [lng,lat],... ]  面:[[[lng,lat],...]]
  [key: string]: unknown;
}

/** 数据集整体状态 */
export interface DataSet {
  name: string;
  fields: FieldDef[];
  rows: RowMap;
  rowIds: string[];
  geometry: GeoFeature[];
}

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
