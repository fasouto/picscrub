import { defineConfig } from 'vite';
import { resolve } from 'path';
import dts from 'vite-plugin-dts';
import type { Plugin } from 'vite';

/**
 * Rollup plugin to prepend a shebang line to a specific output chunk.
 */
function shebangPlugin(): Plugin {
  return {
    name: 'shebang',
    generateBundle(_options, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (fileName.includes('picscrub.cli') && chunk.type === 'chunk') {
          chunk.code = '#!/usr/bin/env node\n' + chunk.code;
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [
    dts({
      include: ['src/**/*'],
      exclude: ['src/**/*.test.ts'],
    }),
    shebangPlugin(),
  ],
  build: {
    lib: {
      entry: {
        picscrub: resolve(__dirname, 'src/index.ts'),
        'picscrub.heic': resolve(__dirname, 'src/formats/heic.ts'),
        'picscrub.node': resolve(__dirname, 'src/node.ts'),
        'picscrub.cli': resolve(__dirname, 'src/cli.ts'),
      },
      formats: ['es', 'cjs'],
      fileName: (format, entryName) => {
        const ext = format === 'es' ? 'js' : 'cjs';
        return `${entryName}.${ext}`;
      },
    },
    rollupOptions: {
      external: [
        'node:fs',
        'node:fs/promises',
        'node:path',
        'node:url',
      ],
      output: {
        preserveModules: false,
        exports: 'named',
      },
    },
    sourcemap: true,
    minify: true,
    target: 'es2022',
  },
});
