// 看板视图：按 single-select 字段分列，卡片展示记录，拖拽卡片到别的列会更新该字段值
// 联动：点击卡片 → onSelectRows（地图飞行 + 高亮）

import { useMemo, useState, useCallback } from 'react';
import type { DataSet, Selection } from '../../types';
import { displayValue, fieldValue } from '../../lib/utils';

export interface KanbanViewProps {
  dataSet: DataSet;
  selectFieldId: string;
  selection: Selection;
  onSelectRows: (rows: string[]) => void;
  onUpdateCell: (rowId: string, fieldId: string, value: unknown) => void;
  filters?: FilterDefLike[];
  sorts?: SortDefLike[];
}

// 宽松复用筛选/排序结构（避免引入严格类型依赖）
interface FilterDefLike { fieldId: string }
interface SortDefLike { fieldId: string }

export default function KanbanView({ dataSet, selectFieldId, selection, onSelectRows, onUpdateCell }: KanbanViewProps) {
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // 分列字段（须为 select 类型）
  const groupField = useMemo(
    () => dataSet.fields.find((f) => f.id === selectFieldId && f.type === 'select') || dataSet.fields.find((f) => f.type === 'select'),
    [dataSet.fields, selectFieldId],
  );

  // 列：groupField.options 里的每个选项 + "未分类"（无该字段值）
  const columns = useMemo(() => {
    if (!groupField) return [];
    const cols = (groupField.options || []).map((opt) => ({ key: opt, label: opt }));
    cols.push({ key: '__none__', label: '未分类' });
    return cols;
  }, [groupField]);

  // 按列分组
  const byColumn = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const col of columns) map[col.key] = [];
    for (const id of dataSet.rowIds) {
      const row = dataSet.rows[id] || {};
      let val = groupField ? displayValue(groupField, fieldValue(row, groupField)) : '';
      if (!val) val = '__none__';
      if (!map[val]) map[val] = [];
      map[val].push(id);
    }
    return map;
  }, [dataSet, columns, groupField]);

  // 标题字段：第一个 text 字段
  const titleField = useMemo(() => dataSet.fields.find((f) => f.type === 'text'), [dataSet.fields]);
  // 副标题字段：第一个非 text 非 coordinate 字段（如 number）
  const subField = useMemo(() => dataSet.fields.find((f) => f.type === 'number' || f.type === 'date'), [dataSet.fields]);

  const handleDrop = useCallback((rowId: string, targetColKey: string) => {
    if (!groupField) return;
    const value = targetColKey === '__none__' ? '' : targetColKey;
    onUpdateCell(rowId, groupField.id, value);
    setDragOverCol(null);
  }, [groupField, onUpdateCell]);

  if (!groupField) {
    return <div className="empty-state"><div className="icon">📋</div><div>看板需要至少一个「单选」类型字段（在「字段」里添加一个选择类字段）</div></div>;
  }

  return (
    <div className="kanban-view">
      {columns.map((col) => (
        <div
          key={col.key}
          className={`kanban-col${dragOverCol === col.key ? ' drag-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.key); }}
          onDragLeave={() => setDragOverCol(null)}
          onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('text/rowId'); if (id) handleDrop(id, col.key); }}
        >
          <div className="kanban-col-head">{col.label} <span className="kanban-col-count">{byColumn[col.key]?.length || 0}</span></div>
          <div className="kanban-col-body">
            {(byColumn[col.key] || []).map((id) => {
              const row = dataSet.rows[id] || {};
              const selected = selection.rowIds.includes(id);
              return (
                <div
                  key={id}
                  className={`kanban-card${selected ? ' selected' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/rowId', id)}
                  onClick={() => onSelectRows(selected ? [] : [id])}
                >
                  {titleField && <div className="kanban-card-title">{displayValue(titleField, fieldValue(row, titleField)) || '（无标题）'}</div>}
                  {subField && <div className="kanban-card-sub">{displayValue(subField, fieldValue(row, subField))}</div>}
                </div>
              );
            })}
            {(byColumn[col.key] || []).length === 0 && <div className="kanban-col-empty">拖拽卡片到此</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
