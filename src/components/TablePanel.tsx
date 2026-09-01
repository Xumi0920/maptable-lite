// 数据表面板：可编辑 / 排序 / 筛选 / 分页 / 行选中 / 与地图联动
// 联动：点击行 → onSelectRows（地图飞行并高亮）；地图选点 → 表格高亮并滚动到该行

import { useMemo, useRef, useState, useCallback, memo } from 'react';
import type { DataSet, FieldDef, Selection, SortDef } from '../types';
import { applySorts, displayValue, fieldValue, parseCoordinate } from '../lib/utils';

interface TablePanelProps {
  dataSet: DataSet;
  selection: Selection;
  onSelectRows: (rows: string[]) => void;
  onUpdateCell: (rowId: string, fieldId: string, value: unknown) => void;
  onAddRow: () => void;
  onDeleteRows: (rowIds: string[]) => void;
  sorts: SortDef[];
  onSortsChange: (s: SortDef[]) => void;
  visibleFieldIds: string[];
  rowRefs: React.MutableRefObject<Map<string, HTMLElement>>;
}

const PAGE_SIZE = 20;

function TablePanelInner(props: TablePanelProps) {
  const {
    dataSet, selection, onSelectRows, onUpdateCell, onAddRow, onDeleteRows,
    sorts, onSortsChange, visibleFieldIds, rowRefs,
  } = props;
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<{ rowId: string; fieldId: string } | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const scrollRef = useRef<HTMLDivElement>(null);

  const fields = dataSet.fields;
  const fieldMap = useMemo(() => new Map(fields.map((f) => [f.id, f])), [fields]);

  // 共享筛选已在 App 层应用；表格只负责排序
  const processed = useMemo(() => {
    return applySorts(dataSet.rowIds, dataSet.rows, fields, sorts);
  }, [dataSet, fields, sorts]);

  const totalPages = Math.max(1, Math.ceil(processed.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = useMemo(() => processed.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE), [processed, safePage]);
  const visibleFields = useMemo(() => {
    if (!visibleFieldIds.length) return fields;
    return visibleFieldIds.map((id) => fieldMap.get(id)).filter((f): f is FieldDef => !!f);
  }, [visibleFieldIds, fields, fieldMap]);

  const toggleSort = useCallback((fieldId: string) => {
    const existing = sorts.find((s) => s.fieldId === fieldId);
    let next: SortDef[];
    if (!existing) next = [{ fieldId, mode: 'asc' }];
    else if (existing.mode === 'asc') next = [{ fieldId, mode: 'desc' }];
    else next = [];
    onSortsChange(next);
  }, [sorts, onSortsChange]);

  const startEdit = useCallback((rowId: string, fieldId: string, current: unknown) => {
    setEditing({ rowId, fieldId });
    setEditingValue(String(current ?? ''));
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const field = fieldMap.get(editing.fieldId);
    let val: unknown = editingValue;
    if (field?.type === 'number') val = editingValue === '' ? '' : Number(editingValue);
    else if (field?.type === 'coordinate') val = editingValue;
    else val = editingValue;
    onUpdateCell(editing.rowId, editing.fieldId, val);
    setEditing(null);
  }, [editing, fieldMap, onUpdateCell]);


  // 点击行：选中/切换
  const clickRow = useCallback((rowId: string) => {
    if (selection.rowIds.includes(rowId)) {
      // 单选 toggle → 取消
      onSelectRows([]);
    } else {
      onSelectRows([rowId]);
    }
  }, [selection, onSelectRows]);

  const goPage = (p: number) => { setPage(Math.max(1, Math.min(p, totalPages))); };

  return (
    <div className="table-panel">
      {/* 工具条 */}
      <div className="table-toolbar">
        <span className="tool-title">数据表 <small>{processed.length} 条 · 第 {safePage}/{totalPages} 页</small></span>
        <div className="spacer" />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>筛选条件由顶部“筛选”统一管理</span>
      </div>

      {/* 表格 */}
      <div className="data-grid" ref={scrollRef}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 34 }}>#</th>
              {visibleFields.map((f) => {
                const activeSort = sorts.find((s) => s.fieldId === f.id);
                return (
                  <th key={f.id} onClick={() => toggleSort(f.id)}>
                    <span className="th-inner">
                      {f.name}
                      <span className="type-badge">{typeLabel(f.type)}</span>
                      {activeSort && <span className="sort-ind">{activeSort.mode === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                  </th>
                );
              })}
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((id, idx) => {
              const row = dataSet.rows[id] || {};
              const selected = selection.rowIds.includes(id);
              return (
                <tr key={id} className={`row${selected ? ' selected' : ''}`}
                  ref={(el) => { if (el) rowRefs.current.set(id, el); }}
                  onClick={() => clickRow(id)}>
                  <td>{(safePage - 1) * PAGE_SIZE + idx + 1}</td>
                  {visibleFields.map((f) => {
                    const isEditing = editing?.rowId === id && editing?.fieldId === f.id;
                    const val = fieldValue(row, f);
                    const disp = displayValue(f, val);
                    const coord = parseCoordinate(val);
                    return (
                      <td
                        key={f.id}
                        className={!disp ? 'cell-empty' : ''}
                        onClick={(e) => { e.stopPropagation(); if (!isEditing) startEdit(id, f.id, val); }}
                        title={disp}
                      >
                        {isEditing ? (
                          f.type === 'select' ? (
                            <select
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(); }}
                            >
                              {(f.options || []).map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                          ) : (
                            <input
                              autoFocus
                              value={editingValue}
                              onChange={(e) => setEditingValue(e.target.value)}
                              onBlur={commitEdit}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') commitEdit();
                                if (e.key === 'Escape') setEditing(null);
                              }}
                              style={{ width: 130 }}
                            />
                          )
                        ) : f.type === 'coordinate' && coord ? (
                          <span className="coord-cell">{disp} <span className="hover-reveal">⤢</span></span>
                        ) : disp}
                      </td>
                    );
                  })}
                  <td>
                    <button
                      title="删除该行"
                      onClick={(e) => { e.stopPropagation(); onDeleteRows([id]); }}
                      style={{ border: 'none', background: 'transparent', color: 'var(--danger)', padding: '2px' }}
                    >🗑</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {processed.length === 0 && (
          <div className="empty-state">
            <div className="icon">📭</div>
            <div>暂无符合条件的数据</div>
          </div>
        )}
      </div>

      {/* 分页 */}
      <div className="pagination-bar">
        <span>共 {processed.length} 条</span>
        <div className="pager">
          <button disabled={safePage <= 1} onClick={() => goPage(safePage - 1)}>上一页</button>
          {Array.from({ length: totalPages }).map((_, i) => (
            <button key={i} className={i + 1 === safePage ? 'cur' : ''} onClick={() => goPage(i + 1)}>
              {i + 1}
            </button>
          ))}
          <button disabled={safePage >= totalPages} onClick={() => goPage(safePage + 1)}>下一页</button>
        </div>
        <div className="spacer" style={{ flex: 1 }} />
        <button onClick={onAddRow}>+ 新增行</button>
      </div>
    </div>
  );
}

function typeLabel(t: FieldDef['type']): string {
  return { text: '文本', number: '数值', date: '日期', coordinate: '坐标', select: '单选' }[t] || t;
}

const TablePanel = memo(TablePanelInner);
export default TablePanel;
