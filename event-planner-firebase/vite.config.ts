import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vite config: base path set from env at build time for GitHub Pages
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || '/',
})
