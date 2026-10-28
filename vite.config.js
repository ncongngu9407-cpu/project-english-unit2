import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    watch: {
      ignored: [
        '**/*.glb',
        '**/*.gltf',
        '**/*.docx',
        '**/dist/**',
        '**/New folder/**',
        '**/newfolder/**'
      ]
    }
  }
});
