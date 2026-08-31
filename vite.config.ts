import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { defineConfig } from 'vite'

// 项目根目录（ESM 用 import.meta.dirname，不用 __dirname）
const rootDir = import.meta.dirname

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 多入口：主 Web 应用 + 飞书仪表盘插件（rolldown 用 build.rolldownOptions.input）
    rolldownOptions: {
      input: {
        main: resolve(rootDir, 'index.html'),
        feishu: resolve(rootDir, 'feishu-plugin.html'),
      },
      output: {
        // 第三方库按用途拆 chunk（主应用不加载飞书 SDK，首屏更轻）
        manualChunks(id: string) {
          if (id.includes('node_modules/@lark-base-open')) return 'feishu-sdk'
          if (id.includes('node_modules/recharts') || id.includes('node_modules/react-is')) return 'recharts'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/scheduler')) return 'react-vendor'
        },
      },
    },
    // 主应用 index.html 的 modulepreload 会保守地预加载所有 shared chunk（含 feishu-sdk 966KB），
    // 但主应用根本不用飞书 SDK。这里从预加载列表里排除 feishu-sdk：主应用不预取它，
    // 飞书插件运行时仍会通过 import 按需加载（preload 只是提前预取，不影响功能）。
    modulePreload: {
      resolveDependencies(_filename: string, dependencies: string[]) {
        return dependencies.filter((dep) => !dep.includes('feishu-sdk'))
      },
    },
  },
})
