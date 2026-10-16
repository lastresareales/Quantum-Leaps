import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
        server: {
      host: '0.0.0.0',
      port: 5000,
          allowedHosts: true,
      // HMR can be disabled with DISABLE_HMR=true in environments where file watching is noisy.
      hmr: env.DISABLE_HMR !== 'true',
        },
  };
});
