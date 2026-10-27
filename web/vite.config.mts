import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";

let devProxyServer = "http://localhost:8081";
if (process.env.DEV_PROXY_SERVER && process.env.DEV_PROXY_SERVER.length > 0) {
  console.log("Use devProxyServer from environment: ", process.env.DEV_PROXY_SERVER);
  devProxyServer = process.env.DEV_PROXY_SERVER;
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "^/api/v1/sse": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and longer timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/memos.api.v1": {
        target: devProxyServer,
        xfwd: true,
      },
      "^/mcp(?:/|$)": {
        target: devProxyServer,
        xfwd: true,
        timeout: 0,
      },
      "^/file": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(__dirname, "src")}/`,
    },
  },
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: "app-shared",
              test: /[\\/]src[\\/](?:hooks|contexts|lib|utils|types)[\\/]/,
              minShareCount: 2,
              priority: 5,
            },
            // Shared UI primitives otherwise produce dozens of tiny requests on a
            // cold HTTP/1.1 visit, delaying the first original on mobile networks.
            {
              name: "ui-vendor",
              // Map icons use react-dom/server. Keep that renderer in the lazy map
              // chunk instead of making every reading entry download it.
              test: /node_modules[\\/](?:@base-ui|@floating-ui|lucide-react|react|react-dom(?![\\/](?:server|cjs[\\/]react-dom-server))|scheduler)([\\/]|$)/,
              priority: 10,
            },
            {
              name: "utils-vendor",
              test: /node_modules[\\/](dayjs|lodash-es)([\\/]|$)/,
            },
            {
              name: "leaflet-vendor",
              test: /node_modules[\\/]leaflet([\\/]|$)/,
            },
          ],
        },
      },
    },
  },
});
