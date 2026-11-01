import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'
export default defineConfig({ plugins:[react(),tailwind()], optimizeDeps:{exclude:['@ffmpeg/ffmpeg','@ffmpeg/util']}, base:'./' })
