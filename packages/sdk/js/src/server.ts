import { createOpencodeClient, type OpencodeClient } from "./client.js"

export interface ServerOptions {
  directory?: string
  port?: number
  hostname?: string
  cors?: string[]
}

export interface OpencodeServer {
  client: OpencodeClient
  server: { port: number; stop: (closeActive?: boolean) => Promise<void> }
  url: string
  port: number
  stop: () => Promise<void>
}

// Dynamic import path constructed at runtime to prevent TypeScript from analyzing it
const OPENCODE_SERVER_PATH = "@rezrazi/opencode" + "/server/server"

export async function createServer(options: ServerOptions = {}): Promise<OpencodeServer> {
  const { directory = process.cwd(), port = 0, hostname = "127.0.0.1", cors = [] } = options

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = await (Function("p", "return import(p)")(OPENCODE_SERVER_PATH) as Promise<any>)
  const app = mod.Server.createApp({ cors })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Bun = (globalThis as any).Bun
  const server = Bun.serve({
    hostname,
    port,
    fetch: app.fetch,
    idleTimeout: 0,
  })

  const url = `http://${hostname}:${server.port}`

  const client = createOpencodeClient({
    baseUrl: url,
    directory,
  })

  return {
    client,
    server,
    url,
    port: server.port,
    stop: async () => {
      await server.stop(true)
    },
  }
}

export { type OpencodeClient }
