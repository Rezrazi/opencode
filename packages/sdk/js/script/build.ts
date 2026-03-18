#!/usr/bin/env bun
import path from "node:path"
import { fileURLToPath } from "node:url"

import { createClient } from "@hey-api/openapi-ts"
import { $ } from "bun"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await $`bun dev generate > ${dir}/openapi.json`.cwd(path.resolve(dir, "../../opencode"))

await createClient({
  input: "./openapi.json",
  output: {
    path: "./src/v2/gen",
    tsConfigPath: path.join(dir, "tsconfig.json"),
    clean: true,
  },
  plugins: [
    {
      name: "@hey-api/typescript",
      exportFromIndex: false,
    },
    {
      name: "@hey-api/sdk",
      instance: "OpencodeClient",
      exportFromIndex: false,
      auth: false,
      paramsStructure: "flat",
    },
    {
      name: "@hey-api/client-fetch",
      exportFromIndex: false,
      baseUrl: "http://localhost:4096",
    },
  ],
})

await $`bun prettier --write src/gen`
await $`bun prettier --write src/v2`
await $`rm -rf dist`
await $`rm -f tsconfig.tsbuildinfo`
await $`bun x tsc -p tsconfig.json`
await $`rm openapi.json`
