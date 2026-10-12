import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8083,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      includeAssets: ["logo.jpeg", "favicon.ico"],
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,jpg,jpeg,svg,woff2}"],
      },
      manifest: {
        name: "NextGen Intelligence - Staff",
        short_name: "NextGen Staff",
        description: "Staff operations app for NextGen Intelligence",
        theme_color: "#F7F7F5",
        background_color: "#F7F7F5",
        display: "standalone",
        // "any", not "portrait": an installed PWA follows the device. The
        // till has a dedicated landscape-terminal layout (src/lib/pos-layout.ts)
        // that a portrait lock made unreachable on an installed tablet/terminal,
        // and landscape phones are now covered by the mobile layout and by the
        // landscape cases in e2e-tests/tests/staff-mobile-viewport.spec.ts
        // (844x390, 915x412, 667x375). No staff workflow needs portrait.
        orientation: "any",
        start_url: "/",
        icons: [
          {
            src: "/logo.jpeg",
            sizes: "512x512",
            type: "image/jpeg",
            purpose: "any",
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
