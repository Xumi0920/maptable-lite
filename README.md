# Maptable Lite

> 一个把「多维表格 ⇄ 地图」双向联动的开源空间数据工具。基于高德地图 JS API 2.0 + React + Vite + TypeScript，纯前端、开箱即用、数据本地存储，可一键部署到 Cloudflare / GitHub Pages。

**定位**：对标商业产品 [Maptable](https://maptable.com) 的核心差异化能力——**表格与地图的双向联动**。市面两端各有孤岛：`APITable / vika`（表格强、地图弱）和 `kepler.gl / deck.gl`（地图强、无表格交互），本项目正好落在交叉点上。

---

## ✨ 功能

### 数据表
- 字段类型：文本 / 数值 / 日期 / **坐标** / 单选
- 单元格**就地编辑**（点击即编辑，Enter/失焦提交）
- **筛选**（等于 / 不等于 / 包含 / 大于 / 小于）
- **排序**（点击表头：升序 → 降序 → 取消）
- 分页、新增行、删除行、列显隐
- 数据持久化到 **localStorage**（刷新不丢）

### 地图（高德 JS API 2.0）
- 5 种可视化图层：**点位 / 点聚合 / 热力图 / 线 / 面**
- 全图视角 `setFitView`
- 坐标字段切换（下拉选择 / 字段管理里"设为坐标"）
- 点击地图选点、Marker 交互、点聚合点击选中
- 国内底图、中文 POI、加载快

### 表格 ⇄ 地图 双向联动（灵魂）
- **点表格行** → 地图 flyTo 该点并高亮 marker（选中态 zIndex 提升）
- **点地图点** → 表格高亮并平滑滚动到对应行
- **点地图空白** → 取消选择

### 导入 / 导出
- 导入：**CSV / GeoJSON**（自动识别经纬度列，支持 Point / LineString / Polygon）
- 导出：CSV / GeoJSON / 数据 JSON
- 坐标格式宽容：`lng,lat`（支持空格/中文逗号/数组/对象 `{lon,lat}`）

---

## 🚀 快速开始

### 1. 配置高德 Key（必须，地图才能显示）

1. 打开 [高德开放平台](https://lbs.amap.com) → 控制台 → 应用管理 → 创建应用
2. 服务平台选 **「Web端(JS API)」**，获取 **Key** 和 **安全密钥(securityJsCode)**
3. 复制环境变量模板并填入：

```bash
cp .env.example .env
```

编辑 `.env`：

```
VITE_AMAP_KEY=你的高德Web端JS-API-Key
VITE_AMAP_SECURITY_CODE=你的高德安全密钥
```

> ⚠️ 注意：
> - **Web端(JS API) Key** 与 **Web服务 Key** 是两种不同类型，别弄混
> - 2021年12月后申请的 Key 必须同时配置安全密钥 `securityJsCode`
> - `.env` 已被 gitignore，不会泄露到仓库

### 2. 安装 & 运行

```bash
npm install
npm run dev        # 本地开发 http://localhost:5173
```

### 3. 生产构建

```bash
npm run build      # 输出到 dist/
npm run preview    # 本地预览构建产物
```

---

## ☁️ 部署到 Cloudflare Pages（免费）

方法一：**GitHub 直连**（推荐）
1. 把仓库推到 GitHub
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → **Connect to Git**
3. 选择仓库，配置：
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Environment variables**: 添加 `VITE_AMAP_KEY` 和 `VITE_AMAP_SECURITY_CODE`
4. 部署完成即可在线访问

方法二：**Wrangler CLI**（本地直传）

```bash
npm install -g wrangler
wrangler pages deploy dist --project-name maptable-lite
```

方法三：**GitHub Pages**
把 `dist/` 内容推送到 `gh-pages` 分支，或使用 GitHub Actions。

> 💡 高德 Web 端 JS API 免费（非商业用途），个人学习 / 研究场景零成本；底层高德底图加载国内快。

---

## 🧪 验证过的功能（实测）

已在浏览器 + Node 实测通过：
- ✅ 表格渲染 10 条示例数据（含坐标字段）
- ✅ 筛选「类型=景区」→ 只剩 3 条
- ✅ 排序「人流量升序」→ 正确排列
- ✅ 图层切换（点位 / 聚合 / 热力 / 线 / 面）
- ✅ 行选中高亮（点击行 → selected 类）
- ✅ CSV/GeoJSON 导入导出双向往返（27 项单元测试全通过）
- ✅ localStorage 持久化
- ✅ 导入抽屉 UI

---

## 📂 项目结构

```
src/
├── types.ts               # 数据模型类型（字段/行/几何/筛选/排序）
├── lib/
│   ├── useAMap.ts         # 高德地图加载 hook（key 从 VITE_ 注入）
│   ├── usePersisted.ts    # localStorage 持久化 hook
│   ├── utils.ts           # 坐标解析 / 字段值 / 筛选 / 排序 / 几何构建
│   ├── io.ts              # CSV / GeoJSON 导入导出
│   └── sampleData.ts      # 示例数据生成器
├── components/
│   ├── MapPanel.tsx       # 地图面板（图层管理 + 联动逻辑）
│   └── TablePanel.tsx     # 数据表面板（编辑/筛选/排序/分页/联动）
└── App.tsx                # 主应用（状态编排 + 导入导出抽屉 + 字段管理）
```

---

## 🗺️ 路线图（后续可加）

- [ ] 仪表盘统计面板（计数 / 汇总 / TOP N）
- [ ] 多视图切换（看板 / 日历）
- [ ] 空间分析（路径规划 / 等时圈 —— 高德无原生 isochrone，需 OSRM 引擎）
- [ ] 多人协作 / 权限
- [ ] 可复用组件库（别人可嵌入）

---

## 📄 说明

- 数据默认保存在浏览器 localStorage，不经过服务器，私有安全
- 示例数据为北京/厦门部分地标，可被导入数据覆盖
- 坐标统一使用高德 GCJ-02 火星坐标；导入 GPS(WGS84) 数据时建议先转换（高德无自动转换入口，需注意）

## License

MIT
