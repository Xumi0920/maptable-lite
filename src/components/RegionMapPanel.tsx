// 区域地图组件：按行政区聚合着色（choropleth）—— 用内置省界 GeoJSON 实现
// 不依赖高德 DistrictSearch（该插件在 iframe/安全码环境易不回调），静态打包省界，稳定可靠
// 支持：三级下钻（省→市→区县，pathStack 栈驱动）+ 按行政区字段聚合着色（模糊匹配 福建↔福建省）
//      + 悬停 tooltip + 地域切片器 + 区域范围选择 + 明细弹窗；通用字段筛选由上层统一应用

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useAMap } from '../lib/useAMap';
import type { DataSet } from '../types';
import { aggregateByRegion, findRegionField, findMetricField, findCityField, findDistrictField, rowsMatchingRegion, type RegionAggMode } from '../lib/regions';
import { parseProvinces, normalizeRegionName, loadCityGeo, type ProvinceFeature } from '../lib/geo';
import provincesGeo from '../lib/china_provinces.json';
import { fieldValue } from '../lib/utils';


export interface RegionMapPanelProps {
  dataSet: DataSet;
  regionFieldId?: string;
  metricFieldId?: string;
  mode?: RegionAggMode;
}

// 配色主题（5 档色阶，浅→深）。切换后 legend 与 polygon 同步
export type ColorThemeKey = 'orange' | 'green' | 'blue' | 'purple' | 'teal' | 'red';
const COLOR_THEMES: Record<ColorThemeKey, string[]> = {
  orange: ['#ffe9c7', '#ffd394', '#ffb45e', '#ff8f33', '#f2721a'],
  green: ['#e4f4d7', '#c3e89a', '#97d457', '#6abf2d', '#4a9e1c'],
  blue: ['#e0edff', '#b8d5ff', '#85b8ff', '#4f97ff', '#2f74e0'],
  purple: ['#f0e8ff', '#d3bfff', '#ad8cff', '#8a5cf5', '#6d3fd0'],
  teal: ['#dff5f0', '#a8e8dc', '#6fd6c0', '#3fbfa5', '#2a9d8a'],
  red: ['#ffe5e0', '#ffbdb0', '#ff9285', '#f5655e', '#d93b33'],
};
const DEFAULT_THEME: ColorThemeKey = 'orange';
const THEME_LABEL: Record<ColorThemeKey, string> = { orange: '橙色', green: '绿色', blue: '蓝色', purple: '紫色', teal: '青色', red: '红色' };

/** 下钻路径栈节点：记录每级行政区的名字与 adcode */
interface PathNode { name: string; adcode: string }

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
  const [colorTheme, setColorTheme] = useState<ColorThemeKey>(() => (localStorage.getItem('maptable-lite:region-theme') as ColorThemeKey) || DEFAULT_THEME);
  const colorScale = COLOR_THEMES[colorTheme] || COLOR_THEMES[DEFAULT_THEME];
  const changeColorTheme = (k: ColorThemeKey) => { setColorTheme(k); try { localStorage.setItem('maptable-lite:region-theme', k); } catch { /* ignore */ } };
  // 三级下钻路径栈：[]=全国省级；[省]=该省市级视图；[省,市]=该市区县视图
  const [pathStack, setPathStack] = useState<PathNode[]>([]);
  const [geoLoading, setGeoLoading] = useState(false);
  const [detailRegion, setDetailRegion] = useState<{ name: string; adcode: string; depth: number } | null>(null);
  // 地域筛选（切片器特例）：选中某地域（归一化值）后，仅保留该地域的记录用于地图聚合
  const [filterRegion, setFilterRegion] = useState<string | null>(null);


  // 固定省级列表（范围下拉用，不随下钻变化）
  const provinceList = useMemo(() => parseProvinces(provincesGeo), []);

  // 字段
  const regionField = useMemo(() => {
    if (regionFieldId) return dataSet.fields.find((f) => f.id === regionFieldId);
    return findRegionField(dataSet);
  }, [dataSet, regionFieldId]);
  // 城市字段（下钻到省后聚合用）
  const cityField = useMemo(() => findCityField(dataSet), [dataSet]);
  // 区县字段（三级下钻用；无此字段则市级即叶子）
  const districtField = useMemo(() => findDistrictField(dataSet), [dataSet]);
  const metricField = useMemo(() => {
    if (metricFieldId) return dataSet.fields.find((f) => f.id === metricFieldId);
    return findMetricField(dataSet);
  }, [dataSet, metricFieldId]);

  // 当前下钻深度：0=省级，1=市级，2=区县级
  const depth = pathStack.length;
  // 当前聚合用的行政区字段：深度0=省份字段，1=城市字段，2=区县字段（缺字段则回退上一级字段）
  const activeRegionField = useMemo(() => {
    if (depth === 0) return regionField;
    if (depth === 1) return cityField || regionField;
    return districtField || cityField || regionField;
  }, [depth, regionField, cityField, districtField]);

  // 地域筛选可用值：当前深度对应字段（省/市/区县）的去重值。按中文排序，供下拉
  const regionOptions = useMemo(() => {
    const f = activeRegionField;
    if (!f) return [];
    const set = new Set<string>();
    for (const id of dataSet.rowIds) {
      const v = fieldValue(dataSet.rows[id], f);
      if (v != null && String(v).trim()) set.add(String(v).trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'zh'));
  }, [dataSet, activeRegionField]);

  // dataSet 已由 App 层应用共享字段筛选；这里只叠加区域地图专用地域切片器
  const condFiltered = dataSet;

  // 地域筛选后的数据（在通用筛选之上叠加）：filterRegion 为空则全量；否则保留 activeRegionField 归一化值等于 filterRegion（同样归一化）的记录
  const filteredDataSet = useMemo<DataSet>(() => {
    if (!filterRegion) return condFiltered;
    const f = activeRegionField;
    if (!f) return condFiltered;
    const target = normalizeRegionName(filterRegion);
    const keptRows: typeof condFiltered.rows = {};
    const keptIds: string[] = [];
    for (const id of condFiltered.rowIds) {
      const v = fieldValue(condFiltered.rows[id], f);
      if (v == null) continue;
      if (normalizeRegionName(String(v)) === target) {
        keptRows[id] = condFiltered.rows[id];
        keptIds.push(id);
      }
    }
    return { ...condFiltered, rows: keptRows, rowIds: keptIds };
  }, [condFiltered, filterRegion, activeRegionField]);

  // 聚合结果：行政区名(归一化) → 值。基于 filteredDataSet，地域筛选后地图会随筛选重算
  const regionMap = useMemo<Record<string, { name: string; value: number }>>(() => {
    const map: Record<string, { name: string; value: number }> = {};
    if (!activeRegionField) return map;
    for (const agg of aggregateByRegion(filteredDataSet, activeRegionField, metricField, mode)) {
      map[agg.name] = { name: agg.name, value: agg.value };
    }
    return map;
  }, [filteredDataSet, activeRegionField, metricField, mode]);

  // 过滤后记录数（诊断/徽标用）
  const filteredCount = filteredDataSet.rowIds.length;

  // 弹窗聚合值：detailRegion 在 regionMap 中的值
  const regionMapEntry = useMemo(() => {
    if (!detailRegion) return undefined;
    const n = normalizeRegionName(detailRegion.name);
    return Object.entries(regionMap).find(([k]) => normalizeRegionName(k) === n)?.[1];
  }, [detailRegion, regionMap]);

  // 省份值样本（诊断用：看省份字段值格式，判断为何聚合不出）
  const provSample = useMemo(() => {
    if (!activeRegionField) return '';
    return dataSet.rowIds.slice(0, 4).map((id) => String(fieldValue(dataSet.rows[id], activeRegionField) ?? '')).join(' | ');
  }, [dataSet, activeRegionField]);

  // 记录名称字段：优先"名称"，否则第一个 text 字段
  const nameField = useMemo(() => dataSet.fields.find((f) => f.name === '名称' || /名|title|name/i.test(f.name)) || dataSet.fields.find((f) => f.type === 'text'), [dataSet]);

  // 某行政区域的所有记录行（明细弹窗用）：复用 rowsMatchingRegion 纯函数。用 filteredDataSet——字段筛选/地域筛选同样作用于弹窗明细（filter 驱动一切）
  const rowsOfRegion = useMemo(() => {
    if (!detailRegion) return [];
    return rowsMatchingRegion(filteredDataSet, activeRegionField, nameField, metricField, detailRegion.name);
  }, [detailRegion, activeRegionField, filteredDataSet, nameField, metricField]);

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

  // 根据行政区名算颜色（归一化匹配 regionMap，再按 5 档色阶取色）
  const colorOf = useCallback((regionName: string): string => {
    const geoNorm = normalizeRegionName(regionName);
    const entry = Object.entries(regionMap).find(([k]) => normalizeRegionName(k) === geoNorm);
    if (!entry) return '#f0f1f3';
    const vals = Object.values(regionMap).map((v) => v.value);
    const min = Math.min(...vals), max = Math.max(...vals);
    if (max <= min) return colorScale[4];
    const idx = Math.max(0, Math.min(4, Math.floor(((entry[1].value - min) / (max - min)) * 5)));
    return colorScale[idx];
  }, [regionMap, colorScale]);

  // 通用下钻：把当前点击的行政区 push 进路径栈，并按 adcode 拉下一级 GeoJSON
  // depthOf = 点击时该 polygon 所处的深度（0=省级点, 1=市级点）；区县级(2)是叶子，不再下钻
  const drillTo = useCallback(async (node: { name: string; adcode: string }, depthOf: number) => {
    if (depthOf >= 2) return; // 区县是叶子
    setStatus(`加载 ${node.name} ${depthOf === 0 ? '市级' : '区县级'}数据...`);
    setGeoLoading(true);
    try {
      const children = await loadCityGeo(node.adcode);
      if (!children.length) { setStatus(`${node.name} 暂无下级边界`); setGeoLoading(false); return; }
      setPathStack((stack) => [...stack.slice(0, depthOf), { name: node.name, adcode: node.adcode }]);
      setProvinces(children);
      setFilterRegion(null); // 切视图清空地域筛选，避免残留导致地图空白
      setStatus('');
    } catch (e: any) {
      setStatus(String(e?.message || e));
    }
    setGeoLoading(false);
  }, []);

  // 返回到指定深度：0=全国省级，1=某省市级；同时清空地域筛选
  const goToDepth = useCallback((targetDepth: number) => {
    const stack = pathStack.slice(0, targetDepth);
    setPathStack(stack);
    setFilterRegion(null);
    if (targetDepth === 0) {
      try { setProvinces(parseProvinces(provincesGeo)); } catch { /* ignore */ }
    } else {
      // 回退到上一级：按栈顶 adcode 重拉其下级（这里直接重拉，稳定优先）
      const parent = stack[stack.length - 1];
      if (parent?.adcode) {
        setGeoLoading(true);
        loadCityGeo(parent.adcode)
          .then((children) => { setProvinces(children); setStatus(''); })
          .catch((e) => setStatus(String(e?.message || e)))
          .finally(() => setGeoLoading(false));
      }
    }
    setStatus('');
  }, [pathStack]);

  // 选范围跳到某省（范围选择器用）：选省 → drillTo 市级视图；选'全国'回省级并清筛选
  const jumpToProvince = useCallback(async (provName: string) => {
    if (provName === '全国') { goToDepth(0); return; }
    const prov = provinceList.find(p => normalizeRegionName(p.name) === normalizeRegionName(provName));
    if (!prov?.adcode) { setStatus('未找到该省'); return; }
    // 若当前已在市级/区县级，先截断到省级再下钻该省
    setPathStack([]);
    await drillTo({ name: prov.name, adcode: prov.adcode }, 0);
  }, [provinceList, drillTo, goToDepth]);


  // 渲染行政区 polygon（省/市/区县通用：provinces 数组内容随下钻替换）
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
        poly.on('click', () => {
          // 点击区域 → 打开该区域记录明细弹窗（下钻按钮在弹窗内，按深度决定可否再下钻）
          setDetailRegion({ name: prov.name, adcode: prov.adcode, depth });
        });
        polygonsRef.current.push(poly);
      }
    }
    try { map.setFitView(); } catch { /* ignore */ }
    setStatus('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady, provinces, regionMap, colorOf, depth, drillTo]);

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
    // 定位到行政区中心
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
        {/* 面包屑：中国 / 省 / 市（可点回退到任意级） */}
        <span className="region-path">
          <span style={{ cursor: depth > 0 ? 'pointer' : 'default' }} onClick={() => depth > 0 && goToDepth(0)}>中国</span>
          {pathStack.map((node, i) => (
            <span key={i} style={{ cursor: i < depth - 1 ? 'pointer' : 'default' }} onClick={() => i < depth - 1 && goToDepth(i + 1)}>
              {' / '}{node.name}
            </span>
          ))}
        </span>
        <select className="region-back" value={pathStack[0]?.name || '全国'} onChange={(e) => jumpToProvince(e.target.value)} style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginLeft: 6 }} title="范围：选省直跳到该省市级视图">
          <option value="全国">全国</option>
          {provinceList.map((p) => <option key={p.adcode} value={p.name}>{p.name}</option>)}
        </select>
        <select className="region-back" value={filterRegion || '全部'} onChange={(e) => setFilterRegion(e.target.value === '全部' ? null : e.target.value)} style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginLeft: 6 }} title="地域筛选：仅显示选定地域的记录">
          <option value="全部">全部</option>
          {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <div className="spacer" />
        {depth > 0 && (
          <button className="region-back" onClick={() => goToDepth(depth - 1)}>← 返回上一级</button>
        )}

        <button className="region-back" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => setShowDiag((s) => !s)}>
          {showDiag ? '隐藏诊断' : '诊断'}
        </button>
        <select className="region-back" value={colorTheme} onChange={(e) => changeColorTheme(e.target.value as ColorThemeKey)} style={{ padding: '3px 8px', fontSize: 11, cursor: 'pointer' }} title="配色主题">
          {Object.keys(COLOR_THEMES).map((k) => (
            <option key={k} value={k}>{THEME_LABEL[k as ColorThemeKey]}</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {activeRegionField?.name || regionField?.name || '?'} × {metricField ? metricField.name : '计数'}（{modeLabel(mode)}）{filterRegion ? ` · 筛选:${filterRegion}` : ''} · {filteredCount}/{dataSet.rowIds.length} 条
        </span>
      </div>
      <div className="region-map-canvas" ref={containerRef} />
      {status && <div className="region-status">{status}</div>}
      {geoLoading && <div className="region-status" style={{ top: 78 }}>加载下级数据…</div>}
      {showDiag && (
        <div className="region-diag" style={{ position: 'absolute', top: 40, left: 8, fontSize: 10, color: '#666', background: 'rgba(255,255,255,.9)', padding: '6px 10px', borderRadius: 4, zIndex: 20, pointerEvents: 'none', maxWidth: '70%', lineHeight: 1.5 }}>
          <div>高德: {amapLoading ? '⏳加载中' : amapError ? `❌${amapError}` : amapReady ? '✅ready' : '未加载'}</div>
          <div>容器: {containerH}px · 界块: {provinces.length} · 地图块: {polygonsRef.current.length} · 深度: {depth}</div>
          <div>行政区: {activeRegionField?.name || '?'} · 聚合: {Object.keys(regionMap).length} 区 {Object.keys(regionMap).slice(0, 6).join(',')}</div>
          <div>共享筛选后: {dataSet.rowIds.length} 条 · 地域切片: {filterRegion || '(全部)'} · 当前 {filteredCount} 条</div>
          <div>值样本: {provSample || '(空)'}</div>
          <div>{status}</div>
        </div>
      )}

      <div className="region-legend">
        {colorScale.map((c) => <span key={c} className="region-legend-color" style={{ background: c }} />)}
        <div className="region-legend-label">低 → 高</div>
      </div>

      {/* 区域明细弹窗：点行政区看该区域记录；深度<2 且有下级字段时给下钻按钮 */}
      {detailRegion && (
        <div className="region-detail-mask" onClick={() => setDetailRegion(null)}>
          <div className="region-detail-modal" onClick={(e) => e.stopPropagation()}>
            <div className="region-detail-head">
              <span className="region-detail-title">{detailRegion.name} · {activeRegionField?.name || '区域'}明细</span>
              <span className="region-detail-agg">聚合: {fmtNum(regionMapEntry?.value ?? 0)} · {rowsOfRegion.length} 条</span>
              <button className="region-back" onClick={() => setDetailRegion(null)}>✕</button>
            </div>
            <div className="region-detail-list">
              {rowsOfRegion.length ? rowsOfRegion.map((r) => (
                <div key={r.rowId} className="region-detail-row">
                  <span className="region-detail-name">{r.name}</span>
                  <span className="region-detail-val">{r.value == null ? '—' : fmtNum(r.value)}</span>
                </div>
              )) : <div className="region-detail-empty">该区域暂无匹配记录</div>}
            </div>
            {detailRegion.depth < 2 && detailRegion.adcode && (
              <button className="region-back region-detail-drill" onClick={() => {
                const node = { name: detailRegion.name, adcode: detailRegion.adcode };
                const depthOf = detailRegion.depth;
                setDetailRegion(null);
                drillTo(node, depthOf);
              }}>
                ⬇ {detailRegion.depth === 0 ? '下钻到市级' : '下钻到区县级'}
              </button>
            )}
          </div>
        </div>
      )}
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
