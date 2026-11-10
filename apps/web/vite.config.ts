import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load environment variables from monorepo root and local package directory
  const rootDir = path.resolve(__dirname, '../../');
  const env = {
    ...loadEnv(mode, rootDir, ''),
    ...loadEnv(mode, __dirname, ''),
    ...process.env,
  };

  // Determine backend API gateway origin for the /api proxy:
  // 1. Explicit shell override: VITE_API_BASE_URL
  // 2. Explicit shell override: PORT or API_PORT
  // 3. Configured custom VITE_API_BASE_URL from .env (if custom/non-default)
  // 4. Configured PORT / API_PORT from .env
  // 5. Configured VITE_API_BASE_URL from .env
  // 6. Default fallback: http://localhost:4000
  let apiTarget = 'http://localhost:4000';
  if (process.env.VITE_API_BASE_URL) {
    apiTarget = process.env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
  } else if (process.env.PORT || process.env.API_PORT) {
    const port = process.env.PORT || process.env.API_PORT;
    apiTarget = `http://localhost:${port}`;
  } else if (env.VITE_API_BASE_URL && env.VITE_API_BASE_URL !== 'http://localhost:4000/api') {
    apiTarget = env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
  } else if (env.PORT || env.API_PORT) {
    const port = env.PORT || env.API_PORT;
    apiTarget = `http://localhost:${port}`;
  } else if (env.VITE_API_BASE_URL) {
    apiTarget = env.VITE_API_BASE_URL.replace(/\/api\/?$/, '').replace(/\/$/, '');
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          timeout: 180000,
        },
      },
    },
  };
});
