// 演示数据生成器（含坐标字段），用于开箱即用验证，可被 CSV/GeoJSON 导入覆盖

import type { DataSet, FieldDef, Row, RowMap } from '../types';
import { uid } from './utils';

export function createSampleDataSet(): DataSet {
  const fields: FieldDef[] = [
    { id: 'name', name: '名称', type: 'text' },
    { id: 'type', name: '类型', type: 'select', options: ['商场', '景区', '交通枢纽', '酒店', '餐饮'] },
    { id: 'coord', name: '坐标', type: 'coordinate' },
    { id: 'province', name: '省份', type: 'text' },
    { id: 'visits', name: '人流量', type: 'number' },
    { id: 'opened', name: '开业日期', type: 'date' },
  ];

  // 北京/厦门 主要地标位置（GCJ-02，高德坐标）
  const spots: Array<{ name: string; type: string; coord: [number, number]; province: string; visits: number; opened: string }> = [
    { name: '北京南站', type: '交通枢纽', coord: [116.3789, 39.8652], province: '北京', visits: 120000, opened: '2008-08-01' },
    { name: '故宫博物院', type: '景区', coord: [116.3970, 39.9182], province: '北京', visits: 80000, opened: '1925-10-10' },
    { name: '颐和园', type: '景区', coord: [116.2755, 39.9990], province: '北京', visits: 65000, opened: '1750-01-01' },
    { name: '北京SKP', type: '商场', coord: [116.4545, 39.9070], province: '北京', visits: 45000, opened: '2007-04-28' },
    { name: '三里屯太古里', type: '商场', coord: [116.4550, 39.9330], province: '北京', visits: 50000, opened: '2008-08-01' },
    { name: '全聚德(前门店)', type: '餐饮', coord: [116.3990, 39.8930], province: '北京', visits: 12000, opened: '1864-06-01' },
    { name: '王府井希尔顿', type: '酒店', coord: [116.4110, 39.9110], province: '北京', visits: 30000, opened: '2010-06-01' },
    { name: '鼓浪屿', type: '景区', coord: [118.0630, 24.4440], province: '福建', visits: 90000, opened: '2017-07-08' },
    { name: '厦门北站', type: '交通枢纽', coord: [118.0100, 24.5500], province: '福建', visits: 70000, opened: '2012-05-01' },
    { name: '中山路步行街', type: '商场', coord: [118.0820, 24.4570], province: '福建', visits: 55000, opened: '1980-01-01' },
  ];

  const rows: RowMap = {};
  const rowIds: string[] = [];
  for (const s of spots) {
    const id = uid('row');
    rows[id] = {
      name: s.name,
      type: s.type,
      coord: `${s.coord[0].toFixed(5)},${s.coord[1].toFixed(5)}`,
      province: s.province,
      visits: s.visits,
      opened: s.opened,
    } as Row;
    rowIds.push(id);
  }

  return { name: '示例数据', fields, rows, rowIds, geometry: [] };
}

/** 生成加噪的点，用于测试点聚合/热力图（默认关闭，可通过导入启用） */
export function createNoisyPoints(count = 800): DataSet {
  const fields: FieldDef[] = [
    { id: 'name', name: '名称', type: 'text' },
    { id: 'type', name: '类型', type: 'select', options: ['A', 'B', 'C'] },
    { id: 'coord', name: '坐标', type: 'coordinate' },
    { id: 'val', name: '权重', type: 'number' },
  ];
  const rows: RowMap = {};
  const rowIds: string[] = [];
  const cx = 116.4, cy = 39.9;
  for (let i = 0; i < count; i++) {
    const id = uid('row');
    const lat = cy + (Math.random() - 0.5) * 0.5;
    const lng = cx + (Math.random() - 0.5) * 0.5;
    rows[id] = { name: `点位${i}`, type: ['A', 'B', 'C'][i % 3], coord: `${lng.toFixed(5)},${lat.toFixed(5)}`, val: Math.floor(Math.random() * 100) } as Row;
    rowIds.push(id);
  }
  return { name: '随机点位测试', fields, rows, rowIds, geometry: [] };
}
