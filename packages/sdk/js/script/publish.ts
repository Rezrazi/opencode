#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const pkg = (await import("../package.json").then((m) => m.default)) as {
  exports: Record<string, string | object>
  dependencies: Record<string, string>
}
const original = JSON.parse(JSON.stringify(pkg))
function transformExports(exports: Record<string, string | object>) {
  for (const [key, value] of Object.entries(exports)) {
    if (typeof value === "object" && value !== null) {
      transformExports(value as Record<string, string | object>)
    } else if (typeof value === "string") {
      const file = value.replace("./src/", "./dist/").replace(".ts", "")
      exports[key] = {
        import: file + ".js",
        types: file + ".d.ts",
      }
    }
  }
}
transformExports(pkg.exports)
// Add core dependency for published package (not in workspace to avoid turbo cycle)
pkg.dependencies["@rezrazi/opencode"] = original.dependencies["@rezrazi/opencode"] ?? "^" + (await import("../../../opencode/package.json").then((m) => m.default)).version
await Bun.write("package.json", JSON.stringify(pkg, null, 2))
await $`bun pm pack`
await $`npm publish *.tgz --tag ${Script.channel} --registry=https://npm.pkg.github.com`
await Bun.write("package.json", JSON.stringify(original, null, 2))
