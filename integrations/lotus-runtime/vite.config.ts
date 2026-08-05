import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
    pack: {
      entry: ["src/server.ts"],
      outDir: "dist",
      clean: true,
      sourcemap: true,
      banner: { js: "#!/usr/bin/env node\n" },
    },
    test: {
      environment: "node",
      fileParallelism: false,
    },
  }),
);
