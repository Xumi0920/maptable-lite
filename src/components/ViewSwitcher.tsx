// 视图切换容器：顶部 tab（表格/看板/日历）+ 各视图的字段配置选择器
// 视图类型定义在 types/view.ts（ViewType）；每种视图是独立组件（views/ 目录）

import { useMemo, useState } from 'react';
import type { DataSet, FilterDef, Selection, SortDef, ViewType } from '../types';
import TablePanel from './TablePanel';
import KanbanView from './views/KanbanView';
import CalendarView from './views/CalendarView';

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

  return (
    <div className="view-switcher">
      <div className="view-tabs">
        {VIEW_TABS.map((t) => (
          <button key={t.key} className={`view-tab${view === t.key ? ' active' : ''}`} onClick={() => setView(t.key)}>
            <span className="view-tab-icon">{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* 视图配置条：看板/日历时显示字段选择 */}
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

      {/* 当前视图内容 */}
      <div className="view-content">
        {view === 'table' && <TablePanel {...props} />}
        {view === 'kanban' && <KanbanView dataSet={dataSet} selectFieldId={kanbanFieldId} selection={selection} onSelectRows={onSelectRows} onUpdateCell={onUpdateCell} />}
        {view === 'calendar' && <CalendarView dataSet={dataSet} dateFieldId={calendarFieldId} selection={selection} onSelectRows={onSelectRows} />}
      </div>
    </div>
  );
}
