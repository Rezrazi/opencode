import { type Config } from "./gen/types.gen.js"

export type ServerOptions = {
  hostname?: string
  port?: number
  config?: Config
  cors?: string[]
}

type ServerInstance = {
  hostname: string
  port: number
  stop(closeActiveConnections?: boolean): Promise<void>
}

type ServerModule = {
  Server: {
    listen(opts: { hostname: string; port: number; cors?: string[] }): ServerInstance
  }
}

export async function createOpencodeServer(options?: ServerOptions) {
  const hostname = options?.hostname ?? "127.0.0.1"
  const port = options?.port ?? 0

  if (options?.config) {
    process.env.OPENCODE_CONFIG_CONTENT = JSON.stringify(options.config)
  }

  // Use variable to prevent static module resolution by the type checker
  // (the core package uses @/ path aliases and Bun types incompatible with nodenext)
  const serverModule = "@rezrazi/opencode/server/server"
  const { Server } = (await import(serverModule)) as ServerModule

  const server = Server.listen({
    hostname,
    port,
    cors: options?.cors,
  })

  const url = `http://${server.hostname}:${server.port}`

  return {
    url,
    async close() {
      await server.stop()
    },
  }
}
