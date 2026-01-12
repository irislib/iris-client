import {nodePolyfills} from "vite-plugin-node-polyfills"
import {visualizer} from "rollup-plugin-visualizer"
import react from "@vitejs/plugin-react"
import {defineConfig} from "vite"
import config from "config"

// Chat-only build configuration
export default defineConfig({
  plugins: [
    nodePolyfills(),
    react({
      fastRefresh: true,
    }),
    visualizer({
      open: false,
      gzipSize: true,
      filename: "build/chat-stats.html",
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
      "@core": "/src/lib/cashu/core",
    },
  },
  build: {
    outDir: "dist-chat",
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        chat: "apps/chat/index.html",
      },
      external: [],
      onLog(level, log, handler) {
        if (log.code === "CIRCULAR_DEPENDENCY") return
        handler(level, log)
      },
      output: {
        assetFileNames: (assetInfo) => {
          if (assetInfo.name?.endsWith(".wasm")) {
            return "assets/[name][extname]"
          }
          if (assetInfo.name?.includes("worker")) {
            return "assets/[name]-[hash].js"
          }
          return "assets/[name]-[hash][extname]"
        },
        manualChunks: (id) => {
          // Keep chat-related code together
          if (id.includes("/src/chat/") || id.includes("/src/pages/chats/")) {
            return "chat"
          }

          // NDK from local sources
          if (id.includes("/src/lib/ndk/") || id.includes("/src/lib/ndk-cache/")) {
            return "main"
          }

          // Vendor libraries
          const vendorLibs = [
            "react",
            "react-dom/client",
            "react-helmet",
            "markdown-to-jsx",
            "@remixicon/react",
            "nostr-tools",
            "lodash",
            "localforage",
            "dexie",
            "@noble/hashes",
            "@noble/curves",
            "@scure/base",
            "classnames",
            "zustand",
            "debug",
            "nostr-double-ratchet",
          ]
          if (vendorLibs.some((lib) => id.includes(`node_modules/${lib}`))) {
            return "vendor"
          }
        },
      },
    },
    assetsDir: "assets",
    copyPublicDir: true,
  },
  define: {
    CONFIG: config,
    global: {},
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.npm_package_version),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
  },
  server: {
    port: 5174, // Different port from main app
    hmr: {
      overlay: true,
      port: 5174,
    },
  },
  optimizeDeps: {
    exclude: ["@vite/client", "@vite/env"],
    include: ["react", "react-dom"],
  },
  assetsInclude: ["**/*.wasm"],
  worker: {
    format: "es",
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
  },
})
