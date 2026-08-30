// 区域地图组件：按行政区聚合着色（choropleth）—— 用内置省界 GeoJSON 实现
// 不依赖高德 DistrictSearch（该插件在 iframe/安全码环境易不回调），静态打包省界，稳定可靠
// 支持：省级渲染 + 按省份字段聚合着色（模糊匹配 福建↔福建省）+ 悬停 tooltip + 下钻(预留)

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAMap } from '../lib/useAMap';
import type { DataSet } from '../types';
import { aggregateByRegion, findRegionField, findMetricField, type RegionAggMode } from '../lib/regions';
import { parseProvinces, normalizeRegionName, type ProvinceFeature } from '../lib/geo';
import provincesGeo from '../lib/china_provinces.json';
import { fieldValue } from '../lib/utils';

export interface RegionMapPanelProps {
  dataSet: DataSet;
  regionFieldId?: string;
  metricFieldId?: string;
  mode?: RegionAggMode;
}

// 色阶（浅→深 5 档，橙色系）
const COLOR_SCALE = ['#ffe9c7', '#ffd394', '#ffb45e', '#ff8f33', '#f2721a'];

export default function RegionMapPanel({ dataSet, regionFieldId, metricFieldId, mode = 'sum' }: RegionMapPanelProps) {
  const { AMap, loading: amapLoading, ready: amapReady, error: amapError } = useAMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [provinces, setProvinces] = useState<ProvinceFeature[]>([]);
  const [status, setStatus] = useState('');
  const [mapReady, setMapReady] = useState(false);
  const [containerH, setContainerH] = useState(0);
  const [showDiag, setShowDiag] = useState(false);

  // 字段
  const regionField = useMemo(() => {
    if (regionFieldId) return dataSet.fields.find((f) => f.id === regionFieldId);
    return findRegionField(dataSet);
  }, [dataSet, regionFieldId]);
  const metricField = useMemo(() => {
    if (metricFieldId) return dataSet.fields.find((f) => f.id === metricFieldId);
    return findMetricField(dataSet);
  }, [dataSet, metricFieldId]);

  // 聚合结果：省名(归一化) → 值
  const regionMap = useMemo<Record<string, { name: string; value: number }>>(() => {
    const map: Record<string, { name: string; value: number }> = {};
    if (!regionField) return map;
    for (const agg of aggregateByRegion(dataSet, regionField, metricField, mode)) {
      map[agg.name] = { name: agg.name, value: agg.value };
    }
    return map;
  }, [dataSet, regionField, metricField, mode]);

  // 省份值样本（诊断用：看省份字段值格式，判断为何聚合不出）
  const provSample = useMemo(() => {
    if (!regionField) return '';
    return dataSet.rowIds.slice(0, 4).map((id) => String(fieldValue(dataSet.rows[id], regionField) ?? '')).join(' | ');
  }, [dataSet, regionField]);

  // 内置省界 GeoJSON（import 打包进 bundle，飞书 iframe 也必然可达，非 fetch）
  useEffect(() => {
    try { setProvinces(parseProvinces(provincesGeo)); } catch (e) { setStatus(`省界解析失败: ${String(e)}`); }
  }, []);

  // 初始化地图 + 监听容器尺寸变化（飞书 iframe 里容器可能从 0px 才开始有尺寸，需 resize 重算）
  useEffect(() => {
    if (!amapReady || !containerRef.current || mapRef.current) return;
    const map = new AMap!.Map(containerRef.current, { center: [105, 36], zoom: 4 });
    mapRef.current = map;
    // 监听容器尺寸：从0→非0 时 resize 地图，让高德适配真实尺寸（修复 iframe 容器 0px 空白）
    const container = containerRef.current;
    const ro = new ResizeObserver(() => {
      const h = container.offsetHeight;
      if (h > 0 && mapRef.current) {
        setContainerH(h);
        try { mapRef.current.resize?.(); } catch { /* ignore */ }
      }
    });
    ro.observe(container);
    setMapReady(true);
    const initialH = container.offsetHeight;
    if (initialH > 0) setContainerH(initialH);
    return () => {
      ro.disconnect();
      try { map.destroy(); } catch { /* ignore */ } mapRef.current = null; setMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amapReady]);

  // 根据省名算颜色（用 matchProvince 归一化匹配到 GeoJSON 省，再匹配聚合值）
  const colorOf = useCallback((provinceName: string): string => {
    // provinceName 是 GeoJSON 省名（如"北京市"），归一化后去 regionMap 找用户数据的省
    const geoNorm = normalizeRegionName(provinceName);
    const entry = Object.entries(regionMap).find(([k]) => normalizeRegionName(k) === geoNorm);
    if (!entry) return '#f0f1f3';
    const vals = Object.values(regionMap).map((v) => v.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max <= min) return COLOR_SCALE[4];
    const idx = Math.max(0, Math.min(4, Math.floor(((entry[1].value - min) / (max - min)) * 5)));
    return COLOR_SCALE[idx];
  }, [regionMap]);

  // 渲染省界 polygon
  useEffect(() => {
    if (!mapReady || !provinces.length) return;
    const map = mapRef.current;
    // 清旧
    polygonsRef.current.forEach((p) => { try { p.setMap(null); } catch { /* ignore */ } });
    polygonsRef.current = [];
    for (const prov of provinces) {
      const color = colorOf(prov.name);
      for (const path of prov.paths) {
        const poly = new AMap!.Polygon({
          map, strokeWeight: 1, strokeColor: '#d9d9d9', strokeOpacity: 0.8,
          fillColor: color, fillOpacity: 0.8, path,
          extData: { name: prov.name, adcode: prov.adcode },
        });
        poly.on('mouseover', () => {
          showTooltip(prov, color);
          try { poly.setOptions({ fillOpacity: 0.95 }); } catch { /* ignore */ }
        });
        poly.on('mouseout', () => { hideTooltip(); try { poly.setOptions({ fillOpacity: 0.8 }); } catch { /* ignore */ } });
        polygonsRef.current.push(poly);
      }
    }
    try { map.setFitView(); } catch { /* ignore */ }
    setStatus('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, provinces, regionMap, colorOf]);

  const showTooltip = (prov: ProvinceFeature, _color: string) => {
    const map = mapRef.current;
    if (!map) return;
    if (!tooltipRef.current) {
      const el = document.createElement('div');
      el.className = 'region-tooltip';
      document.body.appendChild(el);
      tooltipRef.current = el;
    }
    const entry = Object.entries(regionMap).find(([k]) => normalizeRegionName(k) === normalizeRegionName(prov.name));
    const valText = entry ? `：${fmtNum(entry[1].value)}` : '：无数据';
    tooltipRef.current.innerHTML = `${prov.name}${valText}`;
    tooltipRef.current.style.display = 'block';
    // 定位到省中心
    const center = prov.paths[0]?.[0];
    if (center) {
      const px = map.lngLatToContainer?.(center);
      if (px) { tooltipRef.current.style.left = (px.getX?.() ?? 0) + 12 + 'px'; tooltipRef.current.style.top = (px.getY?.() ?? 0) - 12 + 'px'; }
    }
  };
  const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; };

  if (amapError) return <div className="empty-state"><div className="icon">⚠️</div><div>地图加载失败：{String(amapError)}</div></div>;
  if (!amapReady) return <div className="empty-state"><div className="icon">🗺️</div><div>正在加载地图…</div></div>;
  if (!regionField) return <div className="empty-state"><div className="icon">🗺️</div><div>未识别到行政区字段（需表里有「省份/城市/地区」字段）</div></div>;

  return (
    <div className="region-map-view">
      <div className="region-map-topbar">
        <span className="region-path">中国</span>
        <div className="spacer" />
        <button className="region-back" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => setShowDiag((s) => !s)}>
          {showDiag ? '隐藏诊断' : '诊断'}
        </button>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {regionField.name} × {metricField ? metricField.name : '计数'}（{modeLabel(mode)}）
        </span>
      </div>
      <div className="region-map-canvas" ref={containerRef} />
      {status && <div className="region-status">{status}</div>}
      {showDiag && (
        <div className="region-diag" style={{ position: 'absolute', top: 40, left: 8, fontSize: 10, color: '#666', background: 'rgba(255,255,255,.9)', padding: '6px 10px', borderRadius: 4, zIndex: 20, pointerEvents: 'none', maxWidth: '70%', lineHeight: 1.5 }}>
          <div>高德: {amapLoading ? '⏳加载中' : amapError ? `❌${amapError}` : amapReady ? '✅ready' : '未加载'}</div>
          <div>容器: {containerH}px · 省界: {provinces.length} · 地图块: {polygonsRef.current.length}</div>
          <div>行政区: {regionField?.name || '?'} · 聚合: {Object.keys(regionMap).length} 省 {Object.keys(regionMap).slice(0, 6).join(',')}</div>
          <div>省份值样本: {provSample || '(空)'}</div>
          <div>{status}</div>
        </div>
      )}
      <div className="region-legend">
        {COLOR_SCALE.map((c) => <span key={c} className="region-legend-color" style={{ background: c }} />)}
        <div className="region-legend-label">低 → 高</div>
      </div>
    </div>
  );
}

function modeLabel(m: RegionAggMode): string {
  return { count: '计数', sum: '求和', avg: '平均', max: '最大', min: '最小' }[m] || m;
}
function fmtNum(n: number): string {
  if (!isFinite(n)) return '0';
  return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();
}
