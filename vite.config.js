import {defineConfig} from 'vite'

export default defineConfig({
  base: './', // relative paths so GitHub Pages subpath works
  build: {target: 'es2022'}
})
