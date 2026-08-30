import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // 把第三方大库拆成独立 vendor chunk，便于浏览器缓存，降低首屏主包体积
    // （不用动态 import——Vite 动态 import chunk 在该环境有挂起问题；静态拆 chunk 更可靠）
    rolldownOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules/recharts') || id.includes('node_modules/react') || id.includes('node_modules/react-dom') || id.includes('node_modules/react-is') || id.includes('node_modules/scheduler')) {
            return 'vendor'
          }
        },
      },
    },
  },
})
