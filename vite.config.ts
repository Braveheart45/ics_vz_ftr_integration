import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const SERVER_PORT = Number(process.env.SERVER_PORT ?? 3001);

export default defineConfig({
  plugins: [react()],
  // Runtime report data is loaded through the Express API from user-supplied paths.
  // Keep production builds free of copied static report inventories.
  publicDir: false,
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${SERVER_PORT}`,
        changeOrigin: true,
        rewrite: path => path,
      },
    },
  },
});
