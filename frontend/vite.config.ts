import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    cssMinify: true,
    // Split chunks for better caching — vendor libs change rarely
    rollupOptions: {
      output: {
        manualChunks: {
          // React core — cached forever, rarely changes
          'react-vendor': ['react', 'react-dom'],
          // Routing — changes slightly more often
          'router': ['react-router-dom'],
          // Data layer
          'query': ['@tanstack/react-query'],
          // UI utilities
          'ui-vendor': ['lucide-react', 'react-hot-toast', 'react-hook-form'],
          // HTTP + dates
          'utils': ['axios', 'date-fns'],
          // Excel parsing — loaded on-demand when importing
          'xlsx': ['xlsx'],
        },
      },
    },
    // Increase chunk warning limit since we intentionally split
    chunkSizeWarningLimit: 600,
    // Enable source maps for debugging in production (small overhead)
    sourcemap: false,
    // CSS code splitting — each lazy route gets its own CSS
    cssCodeSplit: true,
    // Minify with esbuild (fastest)
    minify: 'esbuild',
  },
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@tanstack/react-query',
      'axios',
      'lucide-react',
      'react-hook-form',
      'react-hot-toast',
      'date-fns',
    ],
  },
});
