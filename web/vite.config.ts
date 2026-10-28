import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // El worker importa el compilador desde ../src.
  server: { fs: { allow: [".."] } },
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
});
