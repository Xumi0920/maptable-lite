// 视图切换容器：顶部 tab（表格/看板/日历/区域地图）+ 各视图的字段配置选择器
// 视图类型定义在 types/view.ts（ViewType）；每种视图是独立组件

import { useMemo, useState } from 'react';
import type { DataSet, FilterDef, Selection, SortDef, ViewType } from '../types';
import type { RegionAggMode } from '../lib/regions';
import { findRegionField, findMetricField } from '../lib/regions';
import TablePanel from './TablePanel';
import KanbanView from './views/KanbanView';
import CalendarView from './views/CalendarView';
import RegionMapPanel from './RegionMapPanel';

export interface ViewSwitcherProps {
  dataSet: DataSet;
  selection: Selection;
  onSelectRows: (rows: string[]) => void;
  onUpdateCell: (rowId: string, fieldId: string, value: unknown) => void;
  onAddRow: () => void;
  onDeleteRows: (rowIds: string[]) => void;
  filters: FilterDef[];
  sorts: SortDef[];
  onFiltersChange: (f: FilterDef[]) => void;
  onSortsChange: (s: SortDef[]) => void;
  visibleFieldIds: string[];
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
}

const VIEW_TABS: Array<{ key: ViewType; label: string; icon: string }> = [
  { key: 'table', label: '表格', icon: '▦' },
  { key: 'kanban', label: '看板', icon: '📋' },
  { key: 'calendar', label: '日历', icon: '📅' },
  { key: 'region', label: '区域地图', icon: '🗺️' },
];

export default function ViewSwitcher(props: ViewSwitcherProps) {
  const { dataSet, selection, onSelectRows, onUpdateCell } = props;
  const [view, setView] = useState<ViewType>('table');

  // 看板分列字段（select）
  const selectFields = useMemo(() => dataSet.fields.filter((f) => f.type === 'select'), [dataSet.fields]);
  const [selectFieldId, setSelectFieldId] = useState('');
  const kanbanFieldId = selectFieldId || selectFields[0]?.id || '';

  // 日历排期字段（date）
  const dateFields = useMemo(() => dataSet.fields.filter((f) => f.type === 'date'), [dataSet.fields]);
  const [dateFieldId, setDateFieldId] = useState('');
  const calendarFieldId = dateFieldId || dateFields[0]?.id || '';

  // 区域地图：行政区字段 / 指标字段 / 聚合方式
  const regionFields = useMemo(() => dataSet.fields.filter((f) => f.type === 'text' || f.type === 'select'), [dataSet.fields]);
  const metricFields = useMemo(() => dataSet.fields.filter((f) => f.type === 'number'), [dataSet.fields]);
  const defaultRegion = useMemo(() => findRegionField(dataSet)?.id || '', [dataSet]);
  const defaultMetric = useMemo(() => findMetricField(dataSet)?.id || '', [dataSet]);
  const [regionFieldId, setRegionFieldId] = useState('');
  const [metricFieldId, setMetricFieldId] = useState('');
  const [aggMode, setAggMode] = useState<RegionAggMode>('sum');
  const regionFieldSel = regionFieldId || defaultRegion;
  const metricFieldSel = metricFieldId || defaultMetric;

  return (
    <div className="view-switcher">
      <div className="view-tabs">
        {VIEW_TABS.map((t) => (
          <button key={t.key} className={`view-tab${view === t.key ? ' active' : ''}`} onClick={() => setView(t.key)}>
            <span className="view-tab-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* 视图配置条 */}
      {(view === 'kanban' || view === 'calendar') && (
        <div className="view-config-bar">
          {view === 'kanban' && (
            <>
              <span className="view-config-label">分列字段：</span>
              <select value={kanbanFieldId} onChange={(e) => setSelectFieldId(e.target.value)}>
                {selectFields.length ? selectFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">（无单选字段）</option>}
              </select>
            </>
          )}
          {view === 'calendar' && (
            <>
              <span className="view-config-label">排期字段：</span>
              <select value={calendarFieldId} onChange={(e) => setDateFieldId(e.target.value)}>
                {dateFields.length ? dateFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">（无日期字段）</option>}
              </select>
            </>
          )}
        </div>
      )}

      {/* 区域地图配置条 */}
      {view === 'region' && (
        <div className="view-config-bar">
          <span className="view-config-label">行政区字段：</span>
          <select value={regionFieldSel} onChange={(e) => setRegionFieldId(e.target.value)}>
            {regionFields.length ? regionFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>) : <option value="">（无文本/单选字段）</option>}
          </select>
          <span className="view-config-label">指标：</span>
          <select value={metricFieldSel} onChange={(e) => setMetricFieldId(e.target.value)}>
            <option value="">（计数）</option>
            {metricFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
          <select value={aggMode} onChange={(e) => setAggMode(e.target.value as RegionAggMode)}>
            <option value="count">计数</option>
            <option value="sum">求和</option>
            <option value="avg">平均</option>
            <option value="max">最大</option>
            <option value="min">最小</option>
          </select>
        </div>
      )}

      {/* 当前视图内容 */}
      <div className="view-content">
        {view === 'table' && <TablePanel {...props} />}
        {view === 'kanban' && <KanbanView dataSet={dataSet} selectFieldId={kanbanFieldId} selection={selection} onSelectRows={onSelectRows} onUpdateCell={onUpdateCell} />}
        {view === 'calendar' && <CalendarView dataSet={dataSet} dateFieldId={calendarFieldId} selection={selection} onSelectRows={onSelectRows} />}
        {view === 'region' && <RegionMapPanel dataSet={dataSet} regionFieldId={regionFieldSel} metricFieldId={metricFieldSel} mode={aggMode} />}
      </div>
    </div>
  );
}
