// Maptable Lite 公共模块出口 —— 统一导出领域类型 / 数据操作 hook / 核心组件

// 类型
export type { FieldType, FieldDef, Row, RowMap, DataSet } from './types/data';
export type { GeometryType, LayerType, GeoFeature } from './types/geometry';
export type { Selection, FilterDef, SortDef, TableConfig } from './types/view';

// 数据操作 hook
export { useDataSetActions, type DataSetActions } from './hooks/useDataSetActions';

// 核心组件
export { default as MapPanel } from './components/MapPanel';
export { default as TablePanel } from './components/TablePanel';
export { default as DashboardPanel } from './components/DashboardPanel';
export { default as ImportDrawer } from './components/drawers/ImportDrawer';
export { default as FieldsDrawer, FIELD_TYPE_OPTIONS } from './components/drawers/FieldsDrawer';

// 工具（常用）
export { parseCoordinate, applyFilters, applySorts, displayValue, uid } from './lib/utils';

// 飞书多维表格适配器（数据源转换）
export {
  pullFromFeishu, pushToFeishu, getTenantToken,
  feishuTypeToFieldType, fieldTypeToFeishuType, fieldsToFeishuCreatePayload,
} from './lib/adapters/feishu';
export type { FeishuTableRef } from './lib/adapters/feishu';
