// CSV / GeoJSON 导入导出
// 导入时自动识别坐标字段（字段名为 lat/lng/lon/latitude/longitude/坐标/经纬度，或值形如 "lng,lat"）

import Papa from 'papaparse';
import * as FileSaver from 'file-saver';
import type { DataSet, FieldDef, Row, RowMap, GeometryType } from '../types';

// 兼容 CJS/ESM interop：file-saver 在 ESM 下没有命名导出 saveAs
const saveAs = (FileSaver as any).saveAs || (FileSaver as any).default?.saveAs;
import { uid, parseCoordinate } from './utils';

const COORD_FIELD_NAMES = ['lng', 'lon', 'longitude', '坐标', '经度', 'lat', 'latitude', '纬度', 'coord', 'coordinate', '经纬度'];

/** 根据表头推断字段类型 */
function inferFields(header: string[]): FieldDef[] {
  return header.map((h) => {
    const key = h.trim();
    const low = key.toLowerCase();
    const id = uid('fld');
    if (COORD_FIELD_NAMES.some((n) => low === n.toLowerCase() || key === n)) {
      return { id, name: key, type: 'coordinate' };
    }
    if (/^(opened|date|日期|时间|time|created|updated)$/i.test(key)) {
      return { id, name: key, type: 'date' };
    }
    return { id, name: key, type: 'text' };
  });
}

/** 从 CSV 文本转 DataSet */
export function csvToDataSet(csvText: string, name = '导入数据'): DataSet {
  const parsed = Papa.parse<Record<string, unknown>>(csvText, { header: true, skipEmptyLines: true });
  const header = parsed.meta.fields || [];
  const fields = inferFields(header);
  const rows: RowMap = {};
  const rowIds: string[] = [];
  parsed.data.forEach((raw) => {
    const id = uid('row');
    const row: Row = {};
    fields.forEach((f) => {
      row[f.id] = raw[f.name] ?? '';
    });
    // 若坐标字段按名称存的是分列 lat/lng，尝试合并；否则保持原样
    rows[id] = row;
    rowIds.push(id);
  });
  return { name, fields, rows, rowIds, geometry: [] };
}

/** 从 GeoJSON 转 DataSet（支持 Point / LineString / Polygon / MultiPoint） */
export function geojsonToDataSet(geojson: unknown, name = 'GeoJSON数据'): DataSet {
  const fc = geojson as { type: string; features: Array<{ type: string; properties?: Record<string, unknown>; geometry?: { type: string; coordinates: unknown } }> };
  if (!fc || !Array.isArray(fc.features)) {
    throw new Error('无效的 GeoJSON：缺少 features 数组');
  }
  const propKeys = new Set<string>();
  fc.features.forEach((f) => Object.keys(f.properties || {}).forEach((k) => propKeys.add(k)));
  const coordFieldName = COORD_FIELD_NAMES.find((n) => n === 'coord' || n === 'coordinate') || '坐标';
  // 先建字段：坐标 + properties 各字段
  let hasCoordField = false;
  const fields: FieldDef[] = [];
  const header = [...propKeys];
  // 判断是否已有经纬度类属性，若有则不再新增额外的坐标字段
  const hasLatLonProps = [...propKeys].some((k) => COORD_FIELD_NAMES.some((n) => k.toLowerCase() === n.toLowerCase() || k === n));
  if (!hasLatLonProps) {
    fields.push({ id: coordFieldName, name: coordFieldName, type: 'coordinate' });
  }
  header.forEach((k) => {
    if (COORD_FIELD_NAMES.some((n) => k.toLowerCase() === n.toLowerCase() || k === n)) {
      if (!hasCoordField) { hasCoordField = true; fields.unshift({ id: k, name: k, type: 'coordinate' }); }
      else { fields.push({ id: k, name: k, type: 'coordinate' }); }
    } else if (/^(opened|date|日期|时间|time|created|updated)$/i.test(k)) {
      fields.push({ id: k, name: k, type: 'date' });
    } else {
      fields.push({ id: k, name: k, type: 'text' });
    }
  });

  const rows: RowMap = {};
  const rowIds: string[] = [];
  const geometry: DataSet['geometry'] = [];
  fc.features.forEach((f) => {
    const id = uid('row');
    const row: Row = {};
    fields.forEach((fe) => {
      if (fe.name === coordFieldName && !hasCoordField) {
        // 坐标字段从 geometry 提取
        const c = geoCoords(f);
        if (c) row[fe.id] = `${c.primary[0].toFixed(6)},${c.primary[1].toFixed(6)}`;
        else row[fe.id] = '';
      } else {
        row[fe.id] = f.properties?.[fe.name] ?? '';
      }
    });
    // 提取 geometry 到 GeoFeature
    const c = geoCoords(f);
    if (c) {
      geometry.push({ id, geometry: geomType(f), coordinates: c.coords });
      if (!hasCoordField) {
        const coordFe = fields.find((fe) => fe.name === coordFieldName && fe.type === 'coordinate');
        if (coordFe && c.coords.length >= 2) row[coordFe.id] = `${c.coords[0][0].toFixed(6)},${c.coords[0][1].toFixed(6)}`;
      }
    }
    rows[id] = row;
    rowIds.push(id);
  });
  return { name, fields, rows, rowIds, geometry };
}

function geoCoords(f: { geometry?: { type: string; coordinates: unknown } }): { coords: number[][]; primary: [number, number] } | null {
  const g = f.geometry;
  if (!g || !g.coordinates) return null;
  const t = g.type;
  const visit = (c: unknown): number[][] | null => {
    if (Array.isArray(c) && c.length >= 2 && typeof c[0] === 'number' && typeof c[1] === 'number') {
      return [[c[0], c[1]]];
    }
    if (Array.isArray(c) && Array.isArray(c[0])) {
      // 递归：多边形/多点
      let out: number[][] = [];
      for (const sub of c) {
        const r = visit(sub);
        if (r) out = out.concat(r);
      }
      return out.length ? out : null;
    }
    return null;
  };
  let coords: number[][] | null = null;
  if (t === 'Point') coords = visit(g.coordinates);
  else if (t === 'MultiPoint' || t === 'LineString') coords = visit(g.coordinates);
  else if (t === 'Polygon') {
    const ring = (g.coordinates as unknown[])[0];
    coords = visit(ring);
  } else if (t === 'MultiPolygon') {
    const poly = (g.coordinates as unknown[])[0];
    const ring = (poly as unknown[])[0];
    coords = visit(ring);
  }
  if (!coords || coords.length === 0) return null;
  const p = coords[0];
  if (!p || p.length < 2) return null;
  return { coords, primary: [p[0], p[1]] };
}

function geomType(f: { geometry?: { type: string } }): GeometryType {
  const t = f.geometry?.type || 'Point';
  if (t === 'Polygon' || t === 'MultiPolygon') return 'polygon';
  if (t === 'LineString' || t === 'MultiLineString') return 'line';
  return 'point';
}

/** DataSet → CSV 文本 */
export function datasetToCsv(ds: DataSet): string {
  const header = ds.fields.map((f) => f.name);
  const rows = ds.rowIds.map((id) => {
    const r = ds.rows[id] || {};
    return header.map((h) => {
      const f = ds.fields.find((fe) => fe.name === h);
      const v = f ? r[f.id] : undefined;
      if (v == null) return '';
      if (typeof v === 'object') return JSON.stringify(v);
      return String(v);
    });
  });
  return Papa.unparse({ fields: header, data: rows });
}

/** DataSet → GeoJSON（FeatureCollection） */
export function datasetToGeojson(ds: DataSet): unknown {
  const features = ds.rowIds.map((id) => {
    const row = ds.rows[id] || {};
    // 找坐标字段
    const coordField = ds.fields.find((f) => f.type === 'coordinate');
    let geometry: { type: string; coordinates: unknown } | null = null;
    if (coordField) {
      const v = row[coordField.id];
      const parsed = parseCoordinate(v);
      if (parsed) geometry = { type: 'Point', coordinates: parsed };
    }
    // 也检查 geometry 数组
    const gf = ds.geometry.find((g) => g.id === id);
    if (!geometry && gf) {
      geometry = { type: gf.geometry === 'polygon' ? 'Polygon' : gf.geometry === 'line' ? 'LineString' : 'Point', coordinates: gf.coordinates };
    }
    const properties: Record<string, unknown> = {};
    ds.fields.forEach((f) => {
      const v = row[f.id];
      if (v != null) properties[f.name] = v;
    });
    return { type: 'Feature', geometry, properties };
  });
  return { type: 'FeatureCollection', features };
}

export function downloadText(filename: string, text: string, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  saveAs(blob, filename);
}

export function downloadJson(filename: string, obj: unknown) {
  downloadText(filename, JSON.stringify(obj, null, 2), 'application/json;charset=utf-8');
}
