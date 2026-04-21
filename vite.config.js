import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  define: {
    __IS_TRIAL__: process.env.IS_TRIAL === 'true',
    __TRIAL_MINUTES__: Number(process.env.TRIAL_MINUTES || 10),
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
})
