import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    // 5173 costuma estar ocupada por outro projeto; strictPort faz falhar
    // explicitamente em vez de migrar de porta em silêncio.
    port: 5180,
    strictPort: true,
    proxy: {
      // Evita CORS: o front chama /api/* e o Vite repassa pro Express na 3000.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
