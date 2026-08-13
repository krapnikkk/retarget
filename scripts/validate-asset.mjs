import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = await createServer({
  appType: "custom",
  configFile: false,
  root,
  optimizeDeps: {
    include: [],
    noDiscovery: true,
  },
  resolve: {
    alias: {
      "@": path.join(root, "src"),
    },
  },
  server: {
    middlewareMode: true,
    watch: null,
  },
});

try {
  const { runValidateAssetCLI } = await server.ssrLoadModule(
    "/src/cli/validate-asset.ts",
  );
  process.exitCode = await runValidateAssetCLI(process.argv.slice(2));
} finally {
  await server.close();
}
