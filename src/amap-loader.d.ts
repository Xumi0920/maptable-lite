// 修正 @amap/amap-jsapi-loader 的类型定义缺失
// 高德 JS API 2.0 的 Loader 配置项支持 securityJsCode（安全密钥），但官方类型未包含

declare module '@amap/amap-jsapi-loader' {
  interface LoadOptions {
    key: string;
    version: string;
    plugins?: string[];
    securityJsCode?: string;
    AMapUI?: { version?: string; plugins?: string[] };
    Loca?: { version?: string };
  }
  interface AMapLoader {
    load(options: LoadOptions): Promise<any>;
    reset(): void;
  }
  const AMapLoader: AMapLoader;
  export default AMapLoader;
}
