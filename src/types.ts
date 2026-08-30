// 类型统一出口（模块化重构后由各领域类型文件提供，这里 re-export 保持向后兼容）

export type { FieldType, FieldDef, Row, RowMap, DataSet } from './types/data';
export type { GeometryType, LayerType, GeoFeature } from './types/geometry';
export type { Selection, FilterDef, SortDef, TableConfig } from './types/view';
