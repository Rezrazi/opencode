#!/usr/bin/env bun

import { fileURLToPath } from "node:url"
import { Script } from "@opencode-ai/script"
import { $ } from "bun"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

const pkg = (await import("../package.json").then((m) => m.default)) as {
  version: string
  scripts?: Record<string, string>
  exports: Record<string, string | object>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const original = JSON.parse(JSON.stringify(pkg))

function resolveWorkspaceDeps(deps: Record<string, string> | undefined) {
  if (!deps) return
  for (const [name, version] of Object.entries(deps)) {
    if (version.startsWith("workspace:")) deps[name] = pkg.version
  }
}

async function resolveCatalogDeps(deps: Record<string, string> | undefined) {
  if (!deps) return
  const root = await Bun.file(`${dir}/../../../package.json`).json()
  const catalog = root.workspaces?.catalog || {}
  for (const [name, version] of Object.entries(deps)) {
    if (!version.startsWith("catalog:")) continue
    deps[name] = catalog[name] || version
  }
}

resolveWorkspaceDeps(pkg.dependencies)
resolveWorkspaceDeps(pkg.devDependencies)
await resolveCatalogDeps(pkg.dependencies)
await resolveCatalogDeps(pkg.devDependencies)

await Bun.write("package.json", JSON.stringify(pkg, null, 2))

try {
  await $`rm -rf dist tsconfig.tsbuildinfo`
  await $`bun x tsc -p tsconfig.json`

  if (!(await Bun.file("dist/client.js").exists())) throw new Error("missing dist/client.js")
  if (!(await Bun.file("dist/client.d.ts").exists())) throw new Error("missing dist/client.d.ts")

  for await (const file of new Bun.Glob("*.tgz").scan()) {
    await $`rm -f ${file}`
  }
  await $`bun pm pack`

  const files = [] as string[]
  for await (const file of new Bun.Glob("*.tgz").scan()) {
    files.push(file)
  }
  if (files.length !== 1) throw new Error(`expected 1 tarball, found ${files.length}`)

  const file = files[0] as string
  const cmds = [
    "npm",
    "publish",
    file,
    "--ignore-scripts",
    "--tag",
    Script.channel,
    "--registry=https://npm.pkg.github.com",
    ...(process.env.OPENCODE_PUBLISH_DRY_RUN ? ["--dry-run"] : []),
  ]
  await $`${cmds}`
} finally {
  await Bun.write("package.json", JSON.stringify(original, null, 2))
}
if (pkg.scripts) delete pkg.scripts.prepublishOnly
