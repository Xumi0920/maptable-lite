// 仪表盘统计面板：统计卡片 + 图表（柱状/饼图/折线）
// 数据来自 lib/aggregate.ts 的聚合逻辑，用 Recharts 渲染
// 布局：顶部卡片网格 + 三张图表卡片

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, LineChart, Line, CartesianGrid,
} from 'recharts';
import type { DataSet, FieldDef } from '../types';
import { computeDashboardStats, topRowsByField, colorFor } from '../lib/aggregate';

interface DashboardPanelProps {
  dataSet: DataSet;
  coordField?: FieldDef;
  onClose: () => void;
}

export default function DashboardPanel({ dataSet, onClose }: DashboardPanelProps) {
  // 选中的数值字段（柱状图用）
  const numericFields = useMemo(() => dataSet.fields.filter((f) => f.type === 'number'), [dataSet.fields]);
  const [barFieldId, setBarFieldId] = useState<string>(numericFields[0]?.id || '');
  // 柱状图标签用第一个文本字段
  const labelField = useMemo(() => dataSet.fields.find((f) => f.type === 'text'), [dataSet.fields]);

  const stats = useMemo(() => computeDashboardStats(dataSet), [dataSet]);

  const barData = useMemo(
    () => (barFieldId && labelField ? topRowsByField(dataSet, barFieldId, labelField.id, 8) : []),
    [dataSet, barFieldId, labelField],
  );

  // 第一个单选字段 → 饼图
  const pieGroup = stats.groupStats[0];
  const pieData = useMemo(
    () => (pieGroup ? pieGroup.groups.map((g) => ({ name: g.label, value: g.count })) : []),
    [pieGroup],
  );

  // 第一个日期字段 → 折线
  const trend = stats.trendStats[0];
  const trendData = useMemo(
    () => (trend ? trend.years.map((y) => ({ year: y.year, count: y.count })) : []),
    [trend],
  );

  const numberFields = numericFields;

  return (
    <div className="dashboard-panel">
      <div className="dashboard-header">
        <span className="dashboard-title">📊 仪表盘 <small>{dataSet.name}</small></span>
        <button className="dashboard-close" onClick={onClose}>✕</button>
      </div>

      {/* 统计卡片网格 */}
      <div className="stat-cards">
        <StatCard label="数据总行数" value={stats.totalRows} icon="🗂️" />
        {stats.numericStats.map((s) => (
          <StatCard
            key={s.fieldId + '-sum'}
            label={`${s.fieldName} · 求和`}
            value={fmtNum(s.sum)}
            sub={`平均 ${fmtNum(s.avg)}`}
            icon="∑"
          />
        ))}
        {stats.numericStats.map((s) => (
          <StatCard
            key={s.fieldId + '-range'}
            label={`${s.fieldName} · 区间`}
            value={`${fmtNum(s.min)} ~ ${fmtNum(s.max)}`}
            sub={`${s.count} 个有效值`}
            icon="↕"
          />
        ))}
        {stats.distinctCounts.map((d) => (
          <StatCard key={d.fieldId} label={`${d.fieldName} · 去重`} value={d.distinct} icon="🔀" />
        ))}
        {pieGroup && (
          <StatCard label={`${pieGroup.fieldName} · 分组`} value={pieGroup.groups.length} icon="🏷️" />
        )}
      </div>

      {/* 图表区域 */}
      <div className="chart-grid">
        {/* 柱状图：数值字段 TOP N */}
        <ChartCard title={barFieldId ? `${fieldName(barFieldId) || '数值'} TOP 8` : '数值 TOP 8'}>
          <div className="chart-bar-toolbar">
            <select value={barFieldId} onChange={(e) => setBarFieldId(e.target.value)}>
              {numberFields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
          {barData.length ? (
            <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 560, height: 260 }}>
              <BarChart data={barData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" fill="#2f6bff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">暂无数值数据</div>
          )}
        </ChartCard>

        {/* 饼图：类型占比 */}
        <ChartCard title={pieGroup ? `${pieGroup.fieldName} 占比` : '类型占比'}>
          {pieData.length ? (
            <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 280, height: 260 }}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  isAnimationActive={false} label={false}>
                  {pieData.map((_, i) => <Cell key={i} fill={colorFor(i)} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">暂无分组数据</div>
          )}
        </ChartCard>

        {/* 折线图：年份趋势 */}
        <ChartCard title={trend ? `${trend.fieldName} 年度趋势` : '年度趋势'}>
          {trendData.length ? (
            <ResponsiveContainer width="100%" height={260} initialDimension={{ width: 280, height: 260 }}>
              <LineChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                <XAxis dataKey="year" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="count" stroke="#7c3aed" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">暂无日期数据</div>
          )}
        </ChartCard>
      </div>

      <div className="dashboard-note">
        <small>统计基于当前数据集实时计算 · 示例数据（北京+厦门地标）</small>
      </div>
    </div>
  );

  function fieldName(id: string): string {
    return dataSet.fields.find((f) => f.id === id)?.name || '';
  }
}

/* ---------- 子组件 ---------- */

function StatCard({ label, value, sub, icon }: { label: string; value: number | string; sub?: string; icon: string }) {
  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <div className="stat-body">
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {sub && <div className="stat-sub">{sub}</div>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="chart-card">
      <div className="chart-card-title">{title}</div>
      {children}
    </div>
  );
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return '—';
  if (Math.abs(n) >= 10000) return n.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}
