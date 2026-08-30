// 日历视图：按 date 字段按月排期，每天格子显示落在该天的记录卡片
// 联动：点击卡片 → onSelectRows（地图飞行 + 高亮）

import { useMemo, useState } from 'react';
import type { DataSet, Selection } from '../../types';
import { displayValue, fieldValue } from '../../lib/utils';

export interface CalendarViewProps {
  dataSet: DataSet;
  dateFieldId: string;
  selection: Selection;
  onSelectRows: (rows: string[]) => void;
}

interface DayCell {
  date: Date;
  isCurrentMonth: boolean;
  rows: string[];
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

export default function CalendarView({ dataSet, dateFieldId, selection, onSelectRows }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });

  // 日期字段（须为 date 类型）
  const dateField = useMemo(
    () => dataSet.fields.find((f) => f.id === dateFieldId && f.type === 'date') || dataSet.fields.find((f) => f.type === 'date'),
    [dataSet.fields, dateFieldId],
  );

  // 标题字段
  const titleField = useMemo(() => dataSet.fields.find((f) => f.type === 'text'), [dataSet.fields]);

  // 把记录按日期键分组（yyyy-mm-dd）
  const byDate = useMemo(() => {
    const map: Record<string, string[]> = {};
    if (!dateField) return map;
    for (const id of dataSet.rowIds) {
      const row = dataSet.rows[id] || {};
      const raw = fieldValue(row, dateField);
      if (raw == null || raw === '') continue;
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (!map[key]) map[key] = [];
      map[key].push(id);
    }
    return map;
  }, [dataSet, dateField]);

  // 生成当月网格（42 格：6 周）
  const cells = useMemo<DayCell[]>(() => {
    const year = cursor.getFullYear(), month = cursor.getMonth();
    const first = new Date(year, month, 1);
    const startWeekday = first.getDay();
    const gridStart = new Date(year, month, 1 - startWeekday);
    const out: DayCell[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      out.push({ date: d, isCurrentMonth: d.getMonth() === month, rows: byDate[key] || [] });
    }
    return out;
  }, [cursor, byDate]);

  const title = `${cursor.getFullYear()} 年 ${cursor.getMonth() + 1} 月`;
  const prevMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const nextMonth = () => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));

  if (!dateField) {
    return <div className="empty-state"><div className="icon">📅</div><div>日历需要至少一个「日期」类型字段（在「字段」里添加一个日期字段）</div></div>;
  }

  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <button onClick={prevMonth}>‹ 上月</button>
        <span className="calendar-title">{title}</span>
        <button onClick={() => setCursor(new Date(new Date().getFullYear(), new Date().getMonth(), 1))}>今天</button>
        <button onClick={nextMonth}>下月 ›</button>
      </div>
      <div className="calendar-grid calendar-weekdays">
        {WEEKDAYS.map((w) => <div key={w} className="calendar-weekday">{w}</div>)}
      </div>
      <div className="calendar-grid calendar-days">
        {cells.map((cell, i) => {
          const key = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`;
          const dnum = cell.date.getDate();
          return (
            <div key={i + '-' + key} className={`calendar-cell${cell.isCurrentMonth ? '' : ' dim'}`}>
              <div className="calendar-daynum">{dnum}</div>
              <div className="calendar-cell-rows">
                {cell.rows.map((id) => {
                  const row = dataSet.rows[id] || {};
                  const selected = selection.rowIds.includes(id);
                  return (
                    <div key={id} className={`cal-event${selected ? ' selected' : ''}`}
                      onClick={() => onSelectRows(selected ? [] : [id])}>
                      {titleField ? (displayValue(titleField, fieldValue(row, titleField)) || '（无标题）') : id}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
