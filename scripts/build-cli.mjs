import { build } from "esbuild";
await build({
  entryPoints: ["src/cli/index.ts"],
  outfile: "dist/cli.cjs",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  banner: { js: "#!/usr/bin/env node" },
  legalComments: "eof",
});
