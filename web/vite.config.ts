import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [svelte()],
  build: {
    rollupOptions: {
      input: {
        host: resolve(__dirname, 'index.html'),
        play: resolve(__dirname, 'play.html'),
        board: resolve(__dirname, 'board.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
});
