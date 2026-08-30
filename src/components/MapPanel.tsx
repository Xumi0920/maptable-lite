// 地图面板：封装高德地图，管理所有覆盖物图层，处理与表格的双向联动
// 图层：点位(scatter) / 点聚合(cluster) / 热力(heatmap) / 线(line) / 面(polygon)
// 联动：从表格接收 rows/selected 等 props；回调 onSelectRows 回传表格

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef, memo } from 'react';
import { useAMap, defaultCenter } from '../lib/useAMap';
import type { DataSet, FieldDef, LayerType, Selection } from '../types';
import { anyCoordinate } from '../lib/utils';

export interface MapPanelHandle {
  flyToCoord: (coord: [number, number] | null) => void;
  fitView: () => void;
}

interface MapPanelProps {
  dataSet: DataSet;
  coordField: FieldDef | undefined;
  layer: LayerType;
  onLayerChange: (l: LayerType) => void;
  selection: Selection;
  onSelectRows: (rows: string[]) => void;
  onCoordFieldChange: (fieldId: string) => void;
  onBoundsChange?: (visibleRows: string[]) => void;
}

const layerOptions: Array<{ key: LayerType; label: string }> = [
  { key: 'scatter', label: '点位' },
  { key: 'cluster', label: '聚合' },
  { key: 'heatmap', label: '热力' },
  { key: 'line', label: '线' },
  { key: 'polygon', label: '面' },
];

function MapPanelInner(props: MapPanelProps, ref: React.Ref<MapPanelHandle>) {
  const { AMap, loading, error, ready } = useAMap();
  const { dataSet, coordField, layer, onLayerChange, selection, onSelectRows, onCoordFieldChange } = props;

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const eventHandlersRef = useRef<any[]>([]);

  const [coordFieldId, setCoordFieldId] = useState<string>('');

  const clearOverlays = useCallback(() => {
    const map = mapRef.current;
    if (map) {
      overlaysRef.current.forEach((o) => { try { o.setMap(null); } catch { /* ignore */ } });
      overlaysRef.current = [];
    }
  }, []);

  // 全图视角 —— 手动 center + zoom 渐进搜索，确保框住全部点位（含跨省南北长条数据）
  const doFit = useCallback(() => {
    const map = mapRef.current;
    if (!map || !AMap) return;

    const coords: Array<[number, number]> = [];
    if (dataSet.geometry.length) {
      dataSet.geometry.forEach((g) => {
        if (g.geometry === 'point' && Array.isArray(g.coordinates) && g.coordinates.length >= 2) {
          coords.push([g.coordinates[0], g.coordinates[1]] as [number, number]);
        } else if (g.geometry === 'line' || g.geometry === 'polygon') {
          (g.coordinates as number[][]).forEach((c: number[]) => { if (c.length >= 2) coords.push([c[0], c[1]] as [number, number]); });
        }
      });
    }
    if (!coords.length) {
      for (const id of dataSet.rowIds) {
        const c = anyCoordinate(dataSet.rows[id] || {}, dataSet.fields);
        if (c) { coords.push(c); if (coords.length > 2000) break; }
      }
    }
    if (!coords.length) return;

    const lngs = coords.map((c) => c[0]);
    const lats = coords.map((c) => c[1]);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const centerLng = (minLng + maxLng) / 2;
    const centerLat = (minLat + maxLat) / 2;

    // 中心点：bbox 正中（北京+厦门的中点纬度约32）
    map.setCenter(new (AMap as any).LngLat(centerLng, centerLat));

    // zoom 渐进搜索：从较低级别(4)开始，逐级放大，找到"所有点都在当前视野内"的最大级别
    // （纬度跨越大需要越低的 zoom）
    const latSpan = maxLat - minLat;
    const lngSpan = maxLng - minLng;
    const bigSpan = Math.max(latSpan, lngSpan);
    // 经验起点：跨省(>5度)用低zoom，同城(<2度)用高zoom
    let targetZoom = bigSpan > 8 ? 4 : bigSpan > 4 ? 5 : bigSpan > 2 ? 6 : bigSpan > 0.5 ? 8 : 11;
    map.setZoom(targetZoom);
  }, [dataSet, AMap]);

  // 初始化地图
  useEffect(() => {
    if (!ready || !AMap || !containerRef.current) return;
    if (mapRef.current) return;

    const map = new AMap.Map(containerRef.current, {
      zoom: 8,
      center: defaultCenter(),
      viewMode: '2D',
      resizeEnable: true,
      mapStyle: 'amap://styles/whitesmoke',
    });
    mapRef.current = map;
    map.addControl(new (AMap as any).Scale());
    map.addControl(new (AMap as any).ToolBar({ position: 'RB' }));

    const clickHandler = map.on('click', () => onSelectRows([]));
    eventHandlersRef.current.push(clickHandler);

    setTimeout(() => { doFit(); }, 300);

    return () => {
      clearOverlays();
      eventHandlersRef.current.forEach((h) => { try { h && h.remove && h.remove(); } catch { /* ignore */ } });
      eventHandlersRef.current = [];
      if (mapRef.current) { try { mapRef.current.destroy && mapRef.current.destroy(); } catch { /* ignore */ } mapRef.current = null; }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, AMap]);

  useImperativeHandle(ref, () => ({
    flyToCoord: (coord: [number, number] | null) => {
      const map = mapRef.current;
      if (!map || !coord || !AMap) return;
      map.setZoomAndCenter(14, new (AMap as any).LngLat(coord[0], coord[1]));
    },
    fitView: () => { doFit(); },
  }), [doFit, AMap]);

  useEffect(() => {
    if (coordField) setCoordFieldId(coordField.id);
  }, [coordField]);

  // 主渲染：根据图层类型加载覆盖物
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !AMap || !ready) return;
    clearOverlays();

    const rowsWithCoord: Array<{ id: string; coord: [number, number] }> = [];
    const coordF = coordField && coordField.id ? coordField : dataSet.fields.find((f) => f.type === 'coordinate');
    if (!coordF) return;

    for (const id of dataSet.rowIds) {
      const row = dataSet.rows[id]; if (!row) continue;
      const c = anyCoordinate(row, dataSet.fields);
      if (c) rowsWithCoord.push({ id, coord: c });
    }
    if (!rowsWithCoord.length) return;

    if (layer === 'scatter') renderScatter(rowsWithCoord);
    else if (layer === 'cluster') renderCluster(rowsWithCoord);
    else if (layer === 'heatmap') renderHeatmap(rowsWithCoord);
    else if (layer === 'line' || layer === 'polygon') renderGeo(rowsWithCoord, layer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataSet, layer, coordField, ready, AMap, selection]);

  // selection 变化 → 飞行到第一个选中点
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !AMap) return;
    if (selection.rowIds.length) {
      const first = selection.rowIds[0];
      const row = dataSet.rows[first]; if (!row) return;
      const c = anyCoordinate(row, dataSet.fields);
      if (c) map.setZoomAndCenter(14, new (AMap as any).LngLat(c[0], c[1]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  const renderScatter = (pts: Array<{ id: string; coord: [number, number] }>) => {
    const AM = AMap!;
    const selectedSet = new Set(selection.rowIds);
    const markers = pts.map((p) => {
      const m = new AM.Marker({
        position: new AM.LngLat(p.coord[0], p.coord[1]),
        title: rowTitle(p.id),
        zIndex: selectedSet.has(p.id) ? 200 : 100,
      });
      m.on('click', (e: any) => {
        e.originEvent?.stopPropagation?.();
        if (selectedSet.has(p.id)) onSelectRows([]);
        else onSelectRows([p.id]);
      });
      return m;
    });
    mapRef.current.add(markers);
    overlaysRef.current.push(...markers);
  };

  const renderCluster = (pts: Array<{ id: string; coord: [number, number] }>) => {
    const AM = AMap!;
    const map = mapRef.current;
    const data = pts.map((p) => ({ lnglat: [p.coord[0], p.coord[1]], rowId: p.id }));
    const cluster = new AM.MarkerCluster(map, data, {
      gridSize: 60,
      renderClusterMarker: (context: any) => {
        const count = context.count;
        const size = 20 + Math.min(24, count * 0.5);
        return new AM.Marker({
          position: context.position,
          content: `<div style="background:#2f6bff;color:#fff;border-radius:50%;width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.3)">${count}</div>`,
        });
      },
    });
    cluster.on('click', (e: any) => {
      if (e?.clusterData) {
        const ids = (Array.isArray(e.clusterData) ? e.clusterData : [e.clusterData]).map((d: any) => d.rowId);
        onSelectRows(ids.filter(Boolean));
      } else if (e?.rowId) {
        onSelectRows([e.rowId]);
      }
    });
    overlaysRef.current.push(cluster);
  };

  const renderHeatmap = (pts: Array<{ id: string; coord: [number, number] }>) => {
    const AM = AMap!;
    const map = mapRef.current;
    // 高德 JS API 2.0：热力图插件类名为 AMap.HeatMap（大写 M），
    // 且需通过 map.plugin 确保插件加载后再实例化（否则 heatmap 对象无 setDataSet 方法）
    const ensureHeatMap = (cb: (HeatMap: any) => void) => {
      if (AM.HeatMap) { cb(AM.HeatMap); return; }
      map.plugin(['AMap.HeatMap'], () => {
        // 插件加载后 AMap.HeatMap 应已存在
        cb((AM as any).HeatMap);
      });
    };
    ensureHeatMap((HeatMap: any) => {
      try {
        const heatmap = new HeatMap(map, { radius: 40, opacity: [0, 0.8] });
        heatmap.setDataSet({ data: pts.map((p) => ({ lnglat: [p.coord[0], p.coord[1]], count: 1 })), max: 20 });
        heatmap.setOptions({ gradient: { 0.2: '#00f', 0.4: '#0cf', 0.6: '#0f0', 0.8: '#ff0', 1: '#f00' } });
        overlaysRef.current.push(heatmap);
      } catch (e) {
        // 热力图失败不阻塞其它图层，仅提示
        // eslint-disable-next-line no-console
        console.warn('[maptable] 热力图渲染失败:', e);
      }
    });
  };

  const renderGeo = (pts: Array<{ id: string; coord: [number, number] }>, kind: 'line' | 'polygon') => {
    const AM = AMap!;
    const map = mapRef.current;
    const segs = dataSet.geometry.filter((g) => g.geometry === kind);
    if (segs.length) {
      const overlays = segs.map((g) => {
        const coords = (g.coordinates as number[][]).map((c) => [c[0], c[1]]);
        return kind === 'line'
          ? new AM.Polyline({ path: coords, strokeColor: '#2f6bff', strokeWeight: 4, strokeOpacity: 0.8 })
          : new AM.Polygon({ path: coords, fillColor: '#2f6bff', fillOpacity: 0.25, strokeColor: '#2f6bff', strokeWeight: 3 });
      });
      map.add(overlays);
      overlaysRef.current.push(...overlays);
      return;
    }
    if (kind === 'line' && pts.length >= 2) {
      const path = pts.map((p) => [p.coord[0], p.coord[1]]);
      const line = new AM.Polyline({ path, strokeColor: '#2f6bff', strokeWeight: 4, strokeOpacity: 0.85 });
      map.add(line);
      overlaysRef.current.push(line);
    } else if (kind === 'polygon' && pts.length >= 3) {
      const path = pts.map((p) => [p.coord[0], p.coord[1]]);
      const poly = new AM.Polygon({ path, fillColor: '#2f6bff', fillOpacity: 0.25, strokeColor: '#2f6bff', strokeWeight: 3 });
      map.add(poly);
      overlaysRef.current.push(poly);
    }
  };

  const rowTitle = (id: string) => {
    const row = dataSet.rows[id];
    if (!row) return '';
    const nameF = dataSet.fields.find((f) => f.type === 'text');
    return nameF && row[nameF.id] ? String(row[nameF.id]) : id;
  };

  return (
    <div className="map-panel">
      <div ref={containerRef} id="map"></div>

      <div className="layer-switcher">
        {layerOptions.map((opt) => (
          <button key={opt.key} className={layer === opt.key ? 'active' : ''} onClick={() => onLayerChange(opt.key)}>
            {opt.label}
          </button>
        ))}
      </div>

      <div className="map-toolbar">
        <button onClick={() => doFit()}>全图视角</button>
        {coordField && (
          <select value={coordFieldId} onChange={(e) => onCoordFieldChange(e.target.value)} title="坐标字段">
            {dataSet.fields.map((f) => (
              <option key={f.id} value={f.id}>{f.name}{f.type === 'coordinate' ? '（坐标）' : ''}</option>
            ))}
          </select>
        )}
      </div>

      <div className="map-status">
        显示 {dataSet.rowIds.length} 行 · 图层 {layerOptions.find((o) => o.key === layer)?.label}
      </div>

      {loading && (
        <div className="map-loading">
          <div className="icon">🗺️</div>
          <div>正在加载高德地图…</div>
        </div>
      )}
      {error && (
        <div className="map-error">
          <h3>地图加载失败</h3>
          <p>{error}</p>
          <p>请在项目根目录 .env 文件配置高德 JS API key。</p>
        </div>
      )}
    </div>
  );
}

const MapPanel = memo(forwardRef<MapPanelHandle, MapPanelProps>(MapPanelInner));
export default MapPanel;
