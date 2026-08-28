// electron.vite.config.ts
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
var __electron_vite_injected_dirname = "E:\\deepseekwork\\novel-workshop-desktop\\apps\\desktop";
var workspace = ["@dafuyu/core", "@dafuyu/contracts", "@dafuyu/shared"];
var electron_vite_config_default = defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        input: { index: resolve(__electron_vite_injected_dirname, "src/main/index.ts") },
        external: ["electron", "electron-updater"]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspace })],
    build: {
      rollupOptions: {
        input: { index: resolve(__electron_vite_injected_dirname, "src/preload/index.ts") },
        external: ["electron"]
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__electron_vite_injected_dirname, "src/renderer/index.html") }
      }
    }
  }
});
export {
  electron_vite_config_default as default
};
