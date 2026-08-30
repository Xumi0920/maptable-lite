// 几何领域类型：地图可渲染的图形

/** 几何类型（地图可渲染的图形） */
export type GeometryType = 'point' | 'line' | 'polygon';

/** 图层类型（地图可视化方式） */
export type LayerType = 'scatter' | 'cluster' | 'heatmap' | 'point' | 'line' | 'polygon';

/** 几何对象（坐标用高德 GCJ-02 火星坐标） */
export interface GeoFeature {
  id: string;           // 关联行 id
  geometry: GeometryType;
  coordinates: number[] | number[][];  // 点:[lng,lat]  线:[ [lng,lat],... ]  面:[[[lng,lat],...]]
  [key: string]: unknown;
}
