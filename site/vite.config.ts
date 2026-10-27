import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so the same build works at /poetics/ on GitHub Pages and locally.
  base: "./",
  plugins: [svelte()],
});
