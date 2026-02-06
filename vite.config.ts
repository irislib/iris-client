import {nodePolyfills} from "vite-plugin-node-polyfills"
import {visualizer} from "rollup-plugin-visualizer"
import react from "@vitejs/plugin-react"
import {VitePWA} from "vite-plugin-pwa"
import {defineConfig} from "vite"
import config from "config"

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    nodePolyfills(),
    react({
      fastRefresh: true,
    }),
    VitePWA({
      injectManifest: {
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        globPatterns: ["**/*"],
        rollupOptions: {
          onwarn(warning, warn) {
            if (warning.code === "EVAL" && warning.id?.includes("tseep")) return
            if (
              warning.code === "CHUNK_SIZE_LIMIT" ||
              (typeof warning.message === "string" &&
                warning.message.includes("Some chunks are larger than"))
            ) {
              return
            }
            warn(warning)
          },
        },
      },
      strategies: "injectManifest",
      injectRegister: "script",
      manifest: false,
      srcDir: "src",
      filename: "service-worker.ts",
      registerType: "autoUpdate",
      integration: {
        // The service worker build uses its own Vite config. Match the main build's chunk warning limit
        // to avoid noisy "chunks are larger than 500 kB" warnings.
        configureCustomSWViteBuild(inlineConfig) {
          inlineConfig.build ??= {}
          inlineConfig.build.chunkSizeWarningLimit = 1000
        },
      },
      devOptions: {
        enabled: true,
        type: "module",
      },
    }),
    visualizer({
      open: true,
      gzipSize: true,
      filename: "build/stats.html",
    }),
    visualizer({
      open: false,
      gzipSize: true,
      filename: "build/stats-list.txt",
      template: "list",
    }),
  ],
  resolve: {
    alias: {
      "@": "/src",
      "@core": "/src/lib/cashu/core",
    },
  },
  build: {
    reportCompressedSize: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      input: {
        main: "index.html",
        debug: "debug.html",
      },
      external: [],
      onLog(level, log, handler) {
        if (log.code === "CIRCULAR_DEPENDENCY") return
        if (log.code === "EVAL" && log.id?.includes("tseep")) return
        if (
          typeof log.message === "string" &&
          log.message.includes("is dynamically imported by") &&
          log.message.includes("but also statically imported") &&
          log.message.includes("dynamic import will not move module into another chunk")
        ) {
          return
        }
        handler(level, log)
      },
      output: {
        assetFileNames: (assetInfo) => {
          // Keep WASM files in assets root with original name
          if (assetInfo.name?.endsWith(".wasm")) {
            return "assets/[name][extname]"
          }
          // Worker files should be .js
          if (assetInfo.name?.includes("worker")) {
            return "assets/[name]-[hash].js"
          }
          return "assets/[name]-[hash][extname]"
        },
        manualChunks: (id) => {
          if (id.includes("nostr-social-graph/data/profileData.json")) {
            return "profileData"
          }
          if (
            id.includes("utils/AnimalName") ||
            id.includes("utils/data/animals") ||
            id.includes("utils/data/adjectives")
          ) {
            return "animalname"
          }
          // Cashu core wrapper - separate chunk (only loaded on wallet pages)
          if (id.includes("/src/lib/cashu/")) {
            return "cashu-core"
          }

          // NDK from local sources - keep in main (used everywhere)
          if (id.includes("/src/lib/ndk/") || id.includes("/src/lib/ndk-cache/")) {
            return "main"
          }

          // Bundle small shared components into main (avoid over-splitting)
          if (
            id.includes("/src/shared/components/button/") ||
            id.includes("/src/shared/components/user/Name")
          ) {
            return "main"
          }

          const vendorLibs = [
            "react",
            "react-dom/client",
            "react-helmet",
            "markdown-to-jsx",
            "@remixicon/react",
            "minidenticons",
            "nostr-tools",
            "nostr-social-graph",
            "lodash",
            "lodash/debounce",
            "lodash/throttle",
            "localforage",
            "dexie",
            "@noble/hashes",
            "@noble/curves",
            "@scure/base",
            "@scure/bip32",
            "@scure/bip39",
            "classnames",
            "fuse.js",
            "react-string-replace",
            "tseep",
            "typescript-lru-cache",
            "zustand",
            "blurhash",
            "debug",
            "@cashu/cashu-ts",
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
    global: {}, // needed for custom-event lib
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.npm_package_version),
    "import.meta.env.VITE_BUILD_TIME": JSON.stringify(new Date().toISOString()),
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: [
      "tests/**/*",
      "node_modules/**/*",
      "**/*.bun.test.ts",
      "**/keepalive-bun.test.ts",
      "**/reconnection-integration.bun.test.ts",
      "src/lib/ndk/subscription.test.ts",
      "src/lib/ndk/subscription/index.test.ts",
      "src/lib/ndk/relay/auth-retry.test.ts",
      "src/lib/ndk/ndk/fetchEvent-guardrails.test.ts",
      "src/lib/ndk/events/encryption.test.ts",
      "src/lib/ndk/events/nip19.test.ts",
      "src/lib/ndk/relay/pool/index.test.ts",
      "src/lib/ndk/signers/nip46/index.test.ts",
      "src/lib/ndk/subscription/outbox-late-arrival.test.ts",
      "src/lib/ndk/events/kinds/cashu/tx.test.ts",
      "src/lib/ndk/events/serializer.test.ts",
      "src/lib/ndk/events/repost.test.ts",
      "src/lib/ndk/events/kinds/interest-list.test.ts",
      "src/lib/ndk/events/index.test.ts",
      "src/lib/ndk/events/encode.test.ts",
      "src/lib/ndk/user/index.test.ts",
      "src/lib/ndk/user/follows.test.ts",
      "src/lib/ndk/utils/filter-validation.test.ts",
      "src/lib/ndk/signers/serialization.test.ts",
      "src/lib/ndk/subscription/exclusive-relay.test.ts",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
  },
  server: {
    hmr: {
      overlay: true,
      port: 5173,
    },
    proxy: {
      "/user": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/subscriptions": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/invoices": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/.well-known": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
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
