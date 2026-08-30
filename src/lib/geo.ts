// 内置省界 GeoJSON 解析 + 省名匹配工具（绕开高德 DistrictSearch 的不稳定）
// china_provinces.json 来自阿里 DataV（public/geo/），静态打包，无网络/安全码依赖

import type { GeoFeature } from '../types';

export interface ProvinceFeature {
  name: string;          // 省名（GeoJSON 是"北京市"，用户数据可能是"北京"）
  adcode: string;
  level: string;
  paths: [number, number][][];   // 高德 Polygon 可用的 path 数组（每个 polygon 一个环组）
}

/**
 * 把 GeoJSON FeatureCollection 转成 ProvinceFeature 列表（高德 polygon path）
 * GeoJSON geometry: Point/LineString/Polygon/MultiPolygon → 高德 Polygon path 形式
 */
export function parseProvinces(geojson: any): ProvinceFeature[] {
  const fc = geojson as { features?: Array<{ properties?: any; geometry?: { type: string; coordinates: unknown } }> };
  if (!fc?.features) return [];
  const out: ProvinceFeature[] = [];
  for (const f of fc.features) {
    const props = f.properties || {};
    const paths = coordsToPaths(f.geometry);
    if (!paths.length) continue;
    out.push({ name: props.name || '', adcode: String(props.adcode || ''), level: props.level || '', paths });
  }
  return out;
}

/** GeoJSON 坐标 → 高德 Polygon path（[[lng,lat][]...] 多个多边形） */
function coordsToPaths(geometry?: { type: string; coordinates: unknown }): [number, number][][] {
  if (!geometry) return [];
  const t = geometry.type;
  const c = geometry.coordinates;
  const out: [number, number][][] = [];
  const flatten = (ring: unknown): [number, number][] => {
    const arr = ring as any[];
    if (!Array.isArray(arr) || arr.length < 3) return [];
    return arr.map((p) => [Number(p[0]), Number(p[1])] as [number, number]).filter(([x, y]) => isFinite(x) && isFinite(y));
  };
  if (t === 'Polygon') {
    const rings = c as any[];
    if (Array.isArray(rings) && rings.length) out.push(flatten(rings[0]));  // 外环
  } else if (t === 'MultiPolygon') {
    const polys = c as any[];
    if (Array.isArray(polys)) {
      for (const poly of polys) {
        const rings = poly as any[];
        if (Array.isArray(rings) && rings.length) out.push(flatten(rings[0]));
      }
    }
  }
  // LineString 等非面类型忽略（区域地图只需面）
  return out;
}

/** 去掉省名后缀("省/市/自治区/特别行政区/壮族/回族/维吾尔")，用于模糊匹配 */
export function normalizeRegionName(name: string): string {
  let s = String(name || '').trim();
  s = s.replace(/(省|市|区|县|特别行政区|自治区|地区|盟|自治州)$/g, '');
  s = s.replace(/维吾尔|壮族|回族|蒙古|藏|苗|彝|侗|土家|朝鲜|布依|哈尼|傣|白|黎|佤|满|瑶|景颇|裕固|畲|羌|傈僳|达斡尔|鄂温克|鄂伦春|毛南|仫佬|水|仡佬|拉祜|纳西|东乡|柯尔克孜|保安|撒拉|土|京|塔吉克|乌孜别克|俄罗斯|鄂温克|赫哲|珞巴|门巴/g, '');
  return s;
}

/** 用归一化名字匹配 ProvinceFeature（用户数据省名 vs GeoJSON 省名） */
export function matchProvince(provinces: ProvinceFeature[], rawName: string): ProvinceFeature | undefined {
  const n = normalizeRegionName(rawName);
  if (!n) return undefined;
  return provinces.find((p) => normalizeRegionName(p.name) === n);
}

/** 把 GeoJSON 转成简单 GeoFeature（供地图渲染，备用） */
export function provincesToGeoFeatures(geojson: any): GeoFeature[] {
  return parseProvinces(geojson).map((p) => ({
    id: p.adcode,
    geometry: 'polygon',
    coordinates: p.paths as any,
    name: p.name,
  }));
}

/**
 * 按省 adcode 动态加载该省市级 GeoJSON（阿里 DataV areas_v3/bound/{adcode}_full.json）
 * —— 下钻用：点省级 polygon → 拿到 adcode → 拉该省市界 → 渲染市级 choropleth。
 * 用绝对 URL（避免飞书 iframe 相对路径取不到的问题）；DataV 支持 CORS。
 */
export async function loadCityGeo(adcode: string): Promise<ProvinceFeature[]> {
  const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
  try {
    // DataV 防盗链：任何带 Referer 的请求都 403（连 maptable-lite 域名都拒），只有无 Referer 才 200。
    // 浏览器 fetch 默认带 Referer → 403。用 referrerPolicy:'no-referrer' 让浏览器不发送 Referer（等同无 Referer → 200）。
    const res = await fetch(url, { referrerPolicy: 'no-referrer', mode: 'cors' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const geo = await res.json();
    return parseProvinces(geo);
  } catch (e: any) {
    throw new Error(`加载市级边界失败(${adcode}): ${String(e?.message || e)}`);
  }
}
