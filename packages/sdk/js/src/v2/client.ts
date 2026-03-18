export * from "./gen/types.gen.js"

import { createClient } from "./gen/client/client.gen.js"
import type { Config } from "./gen/client/types.gen.js"
import { OpencodeClient } from "./gen/sdk.gen.js"
export { type Config as OpencodeClientConfig, OpencodeClient }

export function createOpencodeClient(config?: Config & { directory?: string; experimental_workspaceID?: string }) {
  if (!config?.fetch) {
    const customFetch: typeof fetch = (input, init) => fetch(input, init)
    config = {
      ...config,
      fetch: customFetch,
    }
  }

  if (config?.directory) {
    config.headers = {
      ...config.headers,
      "x-opencode-directory": encodeURIComponent(config.directory),
    }
  }

  if (config?.experimental_workspaceID) {
    config.headers = {
      ...config.headers,
      "x-opencode-workspace": config.experimental_workspaceID,
    }
  }

  const client = createClient(config)
  return new OpencodeClient({ client })
}
