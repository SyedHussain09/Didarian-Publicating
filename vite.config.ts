import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { watch: { ignored: ['**/~*.tmp', '**/~$*', '**/arooj-world/**', '**/.tools/**'] } },
  build: { sourcemap: false },
})
