// 区域地图组件：按行政区聚合着色（choropleth）+ 数据下钻
// 用高德 DistrictSearch 拿下级行政区边界 polygon，按聚合值分级设色
// 下钻：点击 省→查市 边界；顶栏"返回上一级"回退

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAMap } from '../lib/useAMap';
import type { DataSet, FieldDef } from '../types';
import { aggregateByRegion, findRegionField, findMetricField, type RegionAggMode } from '../lib/regions';

export interface RegionMapPanelProps {
  dataSet: DataSet;
  regionFieldId?: string;   // 行政区字段 id（默认自动识别）
  metricFieldId?: string;   // 指标字段 id（可选）
  mode?: RegionAggMode;     // 聚合方式
}

// 色阶（从浅到深 5 档）—— 参考 maptable 区域地图橙色系
const COLOR_SCALE = ['#ffe9c7', '#ffd394', '#ffb45e', '#ff8f33', '#f2721a'];

interface StackNode { name: string; level: string; adcode: string }

export default function RegionMapPanel({ dataSet, regionFieldId, metricFieldId, mode = 'sum' }: RegionMapPanelProps) {
  const { AMap, ready: amapReady, error: amapError } = useAMap();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const districtRef = useRef<any>(null);
  const polygonsRef = useRef<any[]>([]);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [stack, setStack] = useState<StackNode[]>([{ name: '中国', level: 'country', adcode: '' }]);
  const [status, setStatus] = useState('');

  // 字段（真正 useMemo）
  const regionField = useMemo<FieldDef | undefined>(() => {
    if (regionFieldId) return dataSet.fields.find((f) => f.id === regionFieldId);
    return findRegionField(dataSet);
  }, [dataSet, regionFieldId]);

  const metricField = useMemo<FieldDef | undefined>(() => {
    if (metricFieldId) return dataSet.fields.find((f) => f.id === metricFieldId);
    return findMetricField(dataSet);
  }, [dataSet, metricFieldId]);

  // 聚合结果：行政区名 → RegionAgg
  const regionMap = useMemo<Record<string, { name: string; value: number }>>(() => {
    const map: Record<string, { name: string; value: number }> = {};
    if (!regionField) return map;
    aggregateByRegion(dataSet, regionField, metricField, mode).forEach((a) => { map[a.name] = a; });
    return map;
  }, [dataSet, regionField, metricField, mode]);

  // 某行政区颜色（线性分 5 档）
  const colorOf = useCallback((name: string): string => {
    const agg = regionMap[name];
    if (!agg) return '#f0f1f3'; // 无数据灰
    const vals = Object.values(regionMap).map((v) => v.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max < min) return COLOR_SCALE[4];
    if (max === min) return COLOR_SCALE[4];
    const idx = Math.max(0, Math.min(4, Math.floor(((agg.value - min) / (max - min)) * 5)));
    return COLOR_SCALE[idx];
  }, [regionMap]);

  const clearPolygons = useCallback(() => {
    polygonsRef.current.forEach((p) => { try { p.setMap(null); } catch { /* ignore */ } });
    polygonsRef.current = [];
  }, []);

  // 绘制某级行政区的子级边界（subList）并着色
  const drawChildren = useCallback((node: any, map: any) => {
    clearPolygons();
    const subs = node.subList || [];
    for (const sub of subs) {
      const bounds = sub.boundaries;
      if (!bounds) continue;
      const color = colorOf(sub.name);
      for (let i = 0; i < bounds.length; i++) {
        const poly = new AMap!.Polygon({
          map, strokeWeight: 1, strokeColor: '#d9d9d9', strokeOpacity: 0.8,
          fillColor: color, fillOpacity: 0.8, path: bounds[i],
          extData: { name: sub.name, adcode: sub.adcode, level: sub.level },
        });
        poly.on('mouseover', () => {
          const d = poly.getExtData?.() || {};
          const agg = regionMap[d.name];
          showTooltip(poly.getPath?.()[0], `${d.name}${agg ? `：${fmtNum(agg.value)}` : '：无数据'}`);
          try { poly.setOptions({ fillOpacity: 0.95 }); } catch { /* ignore */ }
        });
        poly.on('mouseout', () => {
          hideTooltip();
          try { poly.setOptions({ fillOpacity: 0.8 }); } catch { /* ignore */ }
        });
        poly.on('click', () => {
          const d = poly.getExtData?.() || {};
          if (!d.adcode || d.level === 'district' || d.level === 'country') return;
          drillDown(d, map);
        });
        polygonsRef.current.push(poly);
      }
    }
    try { map.setFitView(); } catch { /* ignore */ }
  }, [regionMap, colorOf, clearPolygons]);

  // 查询并绘制某行政区名的下级
  const queryLevel = useCallback((map: any, keyword: string, level: string) => {
    const district = districtRef.current;
    if (!district) return;
    setStatus(`加载 ${keyword} 行政区...`);
    // 第一层查询"中国"用默认级别（subdistrict:1 自动返回省界）；下钻时才 setLevel
    if (keyword !== '中国' && level) {
      try { district.setLevel(level); } catch { /* ignore */ }
    }
    try { district.setExtensions('all'); } catch { /* ignore */ }
    district.search(keyword, (status: string, result: any) => {
      if (status !== 'complete' || !result?.districtList?.length) {
        setStatus(`未找到 ${keyword} 的行政区数据`); return;
      }
      setStatus('');
      // 画该行政区的子级（subList）
      drawChildren(result.districtList[0], map);
    });
  }, [drawChildren]);

  // 初始化地图 + 查中国下级(省界)
  useEffect(() => {
    if (!amapReady || !containerRef.current || mapRef.current) return;
    const map = new AMap!.Map(containerRef.current, { center: [105, 36], zoom: 3.6 });
    mapRef.current = map;
    // DistrictSearch 是懒加载插件，必须 AMap.plugin 同步下发后才能 new，否则对象不可用、search 回调永不触发
    AMap!.plugin(['AMap.DistrictSearch'], () => {
      if (!mapRef.current) return;
      districtRef.current = new AMap!.DistrictSearch({ subdistrict: 1, showbiz: false, extensions: 'all' });
      queryLevel(map, '中国', 'province');
    });
    return () => { try { map.destroy(); } catch { /* ignore */ } mapRef.current = null; districtRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amapReady]);

  // 下钻：点省→查市
  const drillDown = useCallback((d: { name: string; adcode: string; level: string }, map: any) => {
    const district = districtRef.current;
    if (!district) return;
    setStack((prev) => [...prev, { name: d.name, level: d.level, adcode: d.adcode }]);
    setStatus(`加载 ${d.name} 子行政区...`);
    try { district.setLevel(d.level); district.setExtensions('all'); } catch { /* ignore */ }
    district.search(d.adcode, (st: string, res: any) => {
      if (st !== 'complete' || !res?.districtList?.length) { setStatus(`未找到 ${d.name} 下级`); return; }
      setStatus('');
      drawChildren(res.districtList[0], map);
    });
  }, [drawChildren]);

  // 返回上一级
  const goBack = useCallback(() => {
    setStack((prev) => {
      if (prev.length <= 1) return prev;
      const next = prev.slice(0, -1);
      const cur = next[next.length - 1];
      if (mapRef.current && districtRef.current) {
        setTimeout(() => {
          const district = districtRef.current;
          try { district.setLevel('province'); district.setExtensions('all'); } catch { /* ignore */ }
          district.search(cur.adcode || '中国', (st: string, res: any) => {
            if (st === 'complete' && res?.districtList?.length) {
              setStatus('');
              drawChildren(res.districtList[0], mapRef.current);
            }
          });
        }, 0);
      }
      return next;
    });
  }, [drawChildren]);

  // tooltip
  const showTooltip = (lnglat: any, text: string) => {
    const map = mapRef.current;
    if (!map) return;
    if (!tooltipRef.current) {
      const el = document.createElement('div');
      el.className = 'region-tooltip';
      document.body.appendChild(el);
      tooltipRef.current = el;
    }
    tooltipRef.current.innerHTML = text;
    tooltipRef.current.style.display = 'block';
    if (lnglat) {
      const px = map.lngLatToContainer?.(lnglat);
      if (px) { tooltipRef.current.style.left = (px.getX?.() ?? 0) + 12 + 'px'; tooltipRef.current.style.top = (px.getY?.() ?? 0) - 12 + 'px'; }
    }
  };
  const hideTooltip = () => { if (tooltipRef.current) tooltipRef.current.style.display = 'none'; };

  if (amapError) return <div className="empty-state"><div className="icon">⚠️</div><div>地图加载失败：{String(amapError)}</div></div>;
  if (!amapReady) return <div className="empty-state"><div className="icon">🗺️</div><div>正在加载地图…</div></div>;
  if (!regionField) return <div className="empty-state"><div className="icon">🗺️</div><div>未识别到行政区字段（需表里有「省份/城市/地区」文本字段或单选字段）</div></div>;

  return (
    <div className="region-map-view">
      <div className="region-map-topbar">
        <span className="region-path">
          {stack.map((s, i) => (
            <span key={i}>{i > 0 && ' › '}<span style={{ color: i === stack.length - 1 ? 'var(--primary)' : 'var(--muted)' }}>{s.name}</span></span>
          ))}
        </span>
        <div className="spacer" />
        <button className="region-back" onClick={goBack} disabled={stack.length <= 1}>← 返回上一级</button>
      </div>
      <div className="region-map-canvas" ref={containerRef} />
      {status && <div className="region-status">{status}</div>}
      <div className="region-legend">
        {COLOR_SCALE.map((c) => <span key={c} className="region-legend-color" style={{ background: c }} />)}
        <div className="region-legend-label">低 → 高</div>
      </div>
    </div>
  );
}

function fmtNum(n: number): string {
  if (!isFinite(n)) return '0';
  return Math.abs(n) >= 10000 ? (n / 10000).toFixed(1) + '万' : n.toLocaleString();
}
