// 数据集操作 hook：把对 DataSet 的各种修改操作集中在单一 hook/事实源，
// App 只负责编排，具体增删改逻辑与 UI 解耦（模块化）。

import { useCallback } from 'react';
import type { DataSet, FieldDef } from '../types';
import type { PersistedState } from '../lib/usePersisted';
import { uid } from '../lib/utils';

export interface DataSetActions {
  updateCell: (rowId: string, fieldId: string, value: unknown) => void;
  addRow: () => void;
  deleteRows: (rowIds: string[]) => void;
  changeCoordField: (fieldId: string) => void;
  addField: (name: string, type: FieldDef['type']) => void;
  deleteField: (fieldId: string) => void;
  replaceDataSet: (ds: DataSet) => void;
}

export function useDataSetActions(dsState: PersistedState<DataSet>): DataSetActions {
  const setDataSet = dsState.setValue;

  // 更新单元格
  const updateCell = useCallback((rowId: string, fieldId: string, value: unknown) => {
    setDataSet((prev) => {
      const rows = { ...prev.rows };
      if (!rows[rowId]) return prev;
      rows[rowId] = { ...rows[rowId], [fieldId]: value };
      return { ...prev, rows };
    });
  }, [setDataSet]);

  // 新增行
  const addRow = useCallback(() => {
    setDataSet((prev) => {
      const id = uid('row');
      const row = { id };
      return { ...prev, rows: { ...prev.rows, [id]: row }, rowIds: [...prev.rowIds, id] };
    });
  }, [setDataSet]);

  // 删除行
  const deleteRows = useCallback((rowIds: string[]) => {
    const del = new Set(rowIds);
    setDataSet((prev) => {
      const rows = { ...prev.rows };
      rowIds.forEach((id) => delete rows[id]);
      return { ...prev, rows, rowIds: prev.rowIds.filter((id) => !del.has(id)), geometry: prev.geometry.filter((g) => !del.has(g.id)) };
    });
  }, [setDataSet]);

  // 切换坐标字段（地图图层数据源）
  const changeCoordField = useCallback((fieldId: string) => {
    setDataSet((prev) => {
      const fields = prev.fields.map((f) => ({ ...f, type: f.id === fieldId ? 'coordinate' : f.type }));
      return { ...prev, fields };
    });
  }, [setDataSet]);

  // 新增字段
  const addField = useCallback((name: string, type: FieldDef['type']) => {
    if (!name) return;
    setDataSet((prev) => {
      const field: FieldDef = { id: uid('fld'), name, type, options: type === 'select' ? ['选项1', '选项2'] : undefined };
      return { ...prev, fields: [...prev.fields, field] };
    });
  }, [setDataSet]);

  // 删除字段
  const deleteField = useCallback((fieldId: string) => {
    setDataSet((prev) => {
      const fields = prev.fields.filter((f) => f.id !== fieldId);
      const rows: typeof prev.rows = {};
      Object.entries(prev.rows).forEach(([id, r]) => {
        const { [fieldId]: _removed, ...rest } = r;
        rows[id] = rest;
      });
      return { ...prev, fields, rows };
    });
  }, [setDataSet]);

  // 替换整个数据集（导入时用）
  const replaceDataSet = useCallback((ds: DataSet) => {
    setDataSet(ds);
  }, [setDataSet]);

  return { updateCell, addRow, deleteRows, changeCoordField, addField, deleteField, replaceDataSet };
}
