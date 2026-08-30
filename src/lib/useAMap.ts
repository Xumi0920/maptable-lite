// 高德地图 JS API 2.0 加载封装 hook
// 用 @amap/amap-jsapi-loader 加载，暴露 AMap 命名空间 + 加载状态
// 注意：key 与安全密钥（securityJsCode）通过 VITE_ 环境变量注入，不写死源码

import { useEffect, useState } from 'react';
import AMapLoader from '@amap/amap-jsapi-loader';

export interface AMapGlobal {
  Map: any;
  Marker: any;
  CircleMarker: any;
  MarkerCluster: any;
  Heatmap: any;
  Polyline: any;
  Polygon: any;
  InfoWindow: any;
  Geocoder: any;
  PlaceSearch: any;
  LngLat: any;
  Pixel: any;
  MapType: any;
  ToolBar: any;
  Scale: any;
  plugin: (names: string[], cb: () => void) => void;
  event: any;
}

let AMapCache: AMapGlobal | null = null;

const AMAP_KEY = (import.meta.env.VITE_AMAP_KEY as string) || '';
const AMAP_SECURITY = (import.meta.env.VITE_AMAP_SECURITY_CODE as string) || '';

export function useAMap(): { AMap: AMapGlobal | null; loading: boolean; error: string | null; ready: boolean; plugins: string[] } {
  const [amap, setAmap] = useState<AMapGlobal | null>(AMapCache);
  const [loading, setLoading] = useState(!AMapCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (AMapCache) {
      setAmap(AMapCache);
      setLoading(false);
      return;
    }
    if (!AMAP_KEY) {
      setError('未配置高德地图 Key。请复制 .env.example 为 .env，填入 VITE_AMAP_KEY 和 VITE_AMAP_SECURITY_CODE。');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    AMapLoader.load({
      key: AMAP_KEY,
      version: '2.0',
      securityJsCode: AMAP_SECURITY,
      plugins: [
        'AMap.MarkerCluster',
        'AMap.Heatmap',
        'AMap.InfoWindow',
        'AMap.Geocoder',
        'AMap.PlaceSearch',
        'AMap.ToolBar',
        'AMap.Scale',
        'AMap.MapType',
      ],
    })
      .then((AMap: AMapGlobal) => {
        if (cancelled) return;
        AMapCache = AMap;
        setAmap(AMap);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(`高德地图加载失败：${String(e)}`);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = !!amap && !loading && !error;

  return { AMap: amap, loading, error, ready, plugins: ['Marker', 'CircleMarker', 'MarkerCluster', 'Heatmap', 'Polyline', 'Polygon', 'InfoWindow', 'Geocoder', 'PlaceSearch', 'ToolBar', 'Scale', 'MapType'] };
}

/** 宽屏默认中心（全国/华东，可被用户数据覆盖） */
export function defaultCenter(): [number, number] {
  return [116.397428, 39.90923]; // 北京
}
