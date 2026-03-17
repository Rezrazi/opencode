#!/usr/bin/env bun

import { $ } from "bun"
import { fileURLToPath } from "url"

const dir = fileURLToPath(new URL("..", import.meta.url))
process.chdir(dir)

await $`bun pm pack`
await $`npm publish *.tgz --registry=https://npm.pkg.github.com`
