#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import { $ } from "bun"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const pkg = await Bun.file("package.json").json()
const original = await Bun.file("package.json").text()

// Replace workspace:* references with actual versions for publishing
function resolveWorkspaceDeps(deps: Record<string, string> | undefined) {
  if (!deps) return
  for (const [name, version] of Object.entries(deps)) {
    if ((version as string).startsWith("workspace:")) {
      deps[name] = pkg.version
    }
  }
}
resolveWorkspaceDeps(pkg.dependencies)
resolveWorkspaceDeps(pkg.devDependencies)

// Also resolve catalog: references
async function resolveCatalogDeps(deps: Record<string, string> | undefined) {
  if (!deps) return
  const rootPkg = await Bun.file(`${dir}/../../package.json`).json()
  const catalog = rootPkg.workspaces?.catalog || {}
  for (const [name, version] of Object.entries(deps)) {
    if ((version as string).startsWith("catalog:")) {
      deps[name] = catalog[name] || version
    }
  }
}
await resolveCatalogDeps(pkg.dependencies)
await resolveCatalogDeps(pkg.devDependencies)

await Bun.write("package.json", JSON.stringify(pkg, null, 2))
try {
  await $`bun pm pack`
  await $`npm publish *.tgz --registry=https://npm.pkg.github.com`
} finally {
  await Bun.write("package.json", original)
}
