import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        // Phase 5 SOC extension: forward WebSocket upgrade requests (used by
        // /api/soc/realtime/ws) to the FastAPI backend. The HTTP proxy
        // behaviour above is unchanged.
        ws: true
      }
    }
  }
});

