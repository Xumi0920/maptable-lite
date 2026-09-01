// 共享字段筛选面板：受控 FilterNode 树，供表格/看板/日历/区域地图共用
// 顶层节点按 AND 组合；条件组内部支持 AND/OR，UI 最多创建两层嵌套。

import { useCallback } from 'react';
import type { DataSet } from '../types';
import {
  OP_LABEL,
  flattenNodes,
  isFilterGroup,
  newCondId,
  newGroupId,
  opNeedsValue,
  opsForField,
  type FilterCondition,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
} from '../lib/filters';

export interface FilterPanelProps {
  dataSet: DataSet;
  filterTree: FilterNode[];
  onChange: (tree: FilterNode[]) => void;
  onClose?: () => void;
  compact?: boolean;
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: '1px solid var(--border, #e5e7eb)',
  borderRadius: 4,
  padding: '3px 6px',
  fontSize: 11,
};

function mapNodes(nodes: FilterNode[], id: string, mapper: (node: FilterNode) => FilterNode): FilterNode[] {
  return nodes.map((node) => {
    if (node.id === id) return mapper(node);
    if (isFilterGroup(node)) return { ...node, children: mapNodes(node.children, id, mapper) };
    return node;
  });
}

function removeNode(nodes: FilterNode[], id: string): FilterNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => (isFilterGroup(node) ? { ...node, children: removeNode(node.children, id) } : node));
}

export default function FilterPanel({ dataSet, filterTree, onChange, onClose, compact = false }: FilterPanelProps) {
  const updateNode = useCallback((id: string, mapper: (node: FilterNode) => FilterNode) => {
    onChange(mapNodes(filterTree, id, mapper));
  }, [filterTree, onChange]);

  const addCondition = useCallback((parentId?: string) => {
    const field = dataSet.fields[0];
    if (!field) return;
    const condition: FilterCondition = {
      id: newCondId(),
      fieldId: field.id,
      op: opsForField(field.type)[0],
      value: '',
      value2: '',
    };
    if (!parentId) {
      onChange([...filterTree, condition]);
      return;
    }
    onChange(mapNodes(filterTree, parentId, (node) => (
      isFilterGroup(node) ? { ...node, children: [...node.children, condition] } : node
    )));
  }, [dataSet.fields, filterTree, onChange]);

  const addGroup = useCallback((parentId?: string) => {
    const group: FilterGroup = { id: newGroupId(), logic: 'or', children: [] };
    if (!parentId) {
      onChange([...filterTree, group]);
      return;
    }
    onChange(mapNodes(filterTree, parentId, (node) => (
      isFilterGroup(node) ? { ...node, children: [...node.children, group] } : node
    )));
  }, [filterTree, onChange]);

  const updateCondition = useCallback((id: string, patch: Partial<FilterCondition>) => {
    updateNode(id, (node) => {
      if (isFilterGroup(node)) return node;
      const next: FilterCondition = { ...node, ...patch };
      if (patch.fieldId && patch.fieldId !== node.fieldId) {
        const field = dataSet.fields.find((item) => item.id === patch.fieldId);
        next.op = opsForField(field?.type || 'text')[0];
        next.value = '';
        next.value2 = '';
        delete next.legacyDateTime;
        delete next.legacyBlank;
        delete next.legacyNumeric;
      } else if (patch.op && patch.op !== node.op) {
        next.value = '';
        next.value2 = '';
        delete next.legacyDateTime;
        delete next.legacyBlank;
        delete next.legacyNumeric;
      }
      if (patch.value !== undefined || patch.value2 !== undefined) {
        delete next.legacyBlank;
        delete next.legacyNumeric;
      }
      return next;
    });
  }, [dataSet.fields, updateNode]);

  const renderNode = (node: FilterNode, level: number): React.JSX.Element => {
    if (isFilterGroup(node)) {
      return (
        <div key={node.id} style={{ border: '1px dashed var(--border, #d0d3d8)', borderRadius: 6, padding: '6px 6px 2px', marginBottom: 6, background: level === 0 ? 'rgba(47,116,224,.03)' : 'transparent' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <button
              className="region-back"
              style={{ padding: '1px 8px', fontSize: 11, fontWeight: 600, color: node.logic === 'or' ? '#d93b33' : '#2f74e0', borderColor: node.logic === 'or' ? '#d93b33' : '#2f74e0' }}
              onClick={() => updateNode(node.id, (current) => isFilterGroup(current) ? { ...current, logic: current.logic === 'and' ? 'or' : 'and' } : current)}
              title="点击切换 且/或"
            >
              {node.logic === 'or' ? '或' : '且'}
            </button>
            <span style={{ fontSize: 10, color: 'var(--muted, #888)', marginLeft: 4 }}>条件组（{node.children.length}）</span>
            <div style={{ flex: 1 }} />
            {level <= 1 && (
              <button className="region-back" style={{ padding: '1px 6px', fontSize: 10 }} onClick={() => addCondition(node.id)}>+条件</button>
            )}
            {level < 1 && (
              <button className="region-back" style={{ padding: '1px 6px', fontSize: 10, marginLeft: 2 }} onClick={() => addGroup(node.id)}>+组</button>
            )}
            <button className="region-back" style={{ padding: '1px 6px', fontSize: 10, marginLeft: 4 }} onClick={() => onChange(removeNode(filterTree, node.id))}>✕</button>
          </div>
          {!node.children.length && <div style={{ fontSize: 10, color: 'var(--muted, #888)', padding: '2px 0 6px' }}>空组不参与筛选。点右上“+条件”加入。</div>}
          {node.children.map((child) => renderNode(child, level + 1))}
        </div>
      );
    }

    const field = dataSet.fields.find((item) => item.id === node.fieldId);
    const ops = opsForField(field?.type || 'text');
    const needsValue = opNeedsValue(node.op);
    return (
      <div key={node.id} style={{ display: 'flex', gap: 4, alignItems: 'center', marginBottom: 6 }}>
        <select value={node.fieldId} onChange={(event) => updateCondition(node.id, { fieldId: event.target.value })} style={{ ...inputStyle, flex: '1.2' }}>
          {!field && <option value={node.fieldId}>（字段已删除）</option>}
          {dataSet.fields.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <select value={node.op} onChange={(event) => updateCondition(node.id, { op: event.target.value as FilterOp })} style={{ ...inputStyle, flex: '.9' }}>
          {ops.map((op) => <option key={op} value={op}>{OP_LABEL[op]}</option>)}
        </select>
        {needsValue && (
          field?.type === 'select' && field.options?.length ? (
            <select value={node.value || ''} onChange={(event) => updateCondition(node.id, { value: event.target.value })} style={inputStyle}>
              <option value="">（请选择）</option>
              {field.options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input
              type={field?.type === 'date' && !node.legacyDateTime ? 'date' : field?.type === 'number' ? 'number' : 'text'}
              value={node.value || ''}
              onChange={(event) => updateCondition(node.id, { value: event.target.value })}
              placeholder="值"
              style={inputStyle}
            />
          )
        )}
        {node.op === 'between' && (
          <input type={field?.type === 'date' && !node.legacyDateTime ? 'date' : field?.type === 'date' ? 'text' : 'number'} value={node.value2 || ''} onChange={(event) => updateCondition(node.id, { value2: event.target.value })} placeholder="上界" style={inputStyle} />
        )}
        <button className="region-back" style={{ padding: '2px 6px' }} onClick={() => onChange(removeNode(filterTree, node.id))} title="删除条件">✕</button>
      </div>
    );
  };

  return (
    <div
      className="region-filter-panel"
      style={{
        width: compact ? 420 : 460,
        maxWidth: 'calc(100vw - 24px)',
        background: 'var(--card, #fff)',
        border: '1px solid var(--border, #e5e7eb)',
        borderRadius: 8,
        boxShadow: '0 6px 24px rgba(0,0,0,.16)',
        padding: 10,
        maxHeight: 'min(70vh, 560px)',
        overflowY: 'auto',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 12 }}>字段筛选</strong>
        <span style={{ fontSize: 10, color: 'var(--muted, #888)', marginLeft: 6 }}>顶层条件之间为“且”</span>
        <div style={{ flex: 1 }} />
        <button className="region-back" style={{ padding: '2px 7px', fontSize: 10 }} onClick={() => addCondition()}>+ 条件</button>
        <button className="region-back" style={{ padding: '2px 7px', fontSize: 10, marginLeft: 4 }} onClick={() => addGroup()}>+ 组</button>
        {!!filterTree.length && <button className="region-back" style={{ padding: '2px 7px', fontSize: 10, marginLeft: 4 }} onClick={() => onChange([])}>清空</button>}
        {onClose && <button className="region-back" style={{ padding: '2px 7px', fontSize: 10, marginLeft: 4 }} onClick={onClose}>关闭</button>}
      </div>
      {!filterTree.length && <div style={{ fontSize: 11, color: 'var(--muted, #888)', padding: '8px 2px' }}>暂无筛选条件。可添加单个条件或“且/或”条件组。</div>}
      {filterTree.map((node) => renderNode(node, 0))}
      <div style={{ fontSize: 10, color: 'var(--muted, #888)', marginTop: 3 }}>已启用 {flattenNodes(filterTree).length} 个条件 · 修改后立即作用于所有视图</div>
    </div>
  );
}
