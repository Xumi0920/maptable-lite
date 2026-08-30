// 数据模型领域类型：字段 / 行 / 数据集

import type { GeoFeature } from './geometry';

/** 字段类型 */
export type FieldType =
  | 'text'        // 文本
  | 'number'      // 数值
  | 'date'        // 日期
  | 'coordinate'  // 经纬度（核心字段，用于上图）
  | 'select';     // 单选（用于筛选/着色）

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

/** 数据集整体状态 */
export interface DataSet {
  name: string;
  fields: FieldDef[];
  rows: RowMap;
  rowIds: string[];
  geometry: GeoFeature[];
}
