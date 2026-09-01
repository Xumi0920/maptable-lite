// localStorage 持久化 hook，管理数据集 + 视图配置

import { useCallback, useEffect, useState } from 'react';
import type { DataSet, FilterDef, TableConfig } from '../types';
import { legacyFiltersToTree, type FilterNode } from './filters';
import { createSampleDataSet } from './sampleData';

const STORAGE_KEY = 'maptable-lite:dataset';
const CONFIG_KEY = 'maptable-lite:tableconfig';
const FILTER_TREE_KEY = 'maptable-lite:filter-tree';

export interface PersistedState<T> {
  value: T;
  setValue: (v: T | ((prev: T) => T)) => void;
  reset: () => void;
}

function loadFromStorage<T>(key: string, fallback: () => T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    /* ignore */
  }
  return fallback();
}

function usePersisted<T>(key: string, fallback: () => T): PersistedState<T> {
  const [value, setValueState] = useState<T>(() => loadFromStorage(key, fallback));
  const save = useCallback((v: T | ((prev: T) => T)) => {
    setValueState((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* 可能超出 localStorage 配额，忽略 */
      }
      return next;
    });
  }, [key]);
  const reset = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
    setValueState(fallback());
  }, [key, fallback]);
  useEffect(() => { /* 初始已加载 */ }, []);
  return { value, setValue: save, reset };
}

export function useDataSet(): PersistedState<DataSet> {
  return usePersisted<DataSet>(STORAGE_KEY, createSampleDataSet);
}

const DEFAULT_CONFIG: TableConfig = { filters: [], sorts: [], visibleFieldIds: [] };

export function useTableConfig(): PersistedState<TableConfig> {
  return usePersisted<TableConfig>(CONFIG_KEY, () => DEFAULT_CONFIG);
}

/**
 * 跨视图共享的筛选树。首次升级且新 key 不存在时，从 v1 表格 filters 迁移；
 * 后续独立持久化，避免旧 TableConfig 结构限制条件组。
 */
export function useFilterTree(dataSet: DataSet, legacyFilters: FilterDef[]): PersistedState<FilterNode[]> {
  const state = usePersisted<FilterNode[]>(FILTER_TREE_KEY, () => legacyFiltersToTree(legacyFilters, dataSet.fields));
  const setValue = state.setValue;
  const reset = useCallback(() => setValue([]), [setValue]);
  return { ...state, reset };
}
