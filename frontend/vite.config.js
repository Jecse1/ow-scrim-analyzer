import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// 영웅/맵 정본 JSON(SSOT)은 backend/game_data 에 있다. 프론트에서 @gamedata 로 임포트.
const GAME_DATA_DIR = fileURLToPath(new URL('../backend/game_data', import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@gamedata': GAME_DATA_DIR,
    },
  },
  server: {
    host: '0.0.0.0', // 외부 접속 허용
    port: 5173,
    fs: {
      // frontend 루트 밖(backend/game_data)의 JSON 임포트 허용
      allow: ['..', GAME_DATA_DIR],
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000', // 서버 내부의 백엔드 주소
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/api')
      },
      // 밴픽 실시간 대결 WebSocket (개발용) — 백엔드 /ws/banpick 로 프록시
      '/ws': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        changeOrigin: true
      }
    }
  }
})


