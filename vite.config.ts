import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Served from https://aartoghrul.github.io/layered/
  base: "/layered/",
});
