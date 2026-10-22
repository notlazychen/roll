import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时前端跑 5173，接口在 5235，用 vite 代理把 /api 转过去。
// 这样本地也是「同源」调用，和线上（nginx 的 /api/ 反代）行为一致，
// 前端代码里永远写相对路径 /api/xxx，不需要区分环境。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:5235',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
})
