import { Log } from "../util/log"
import { StorageDriver } from "./driver"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

/**
 * PostgreSQL storage driver using native postgres client
 */
export class PostgresDriver implements StorageDriver.Driver {
  private log = Log.create({ service: "storage:postgres" })
  private sql: any
  private poolSize: number

  constructor(private config: Extract<StorageDriver.Config, { driver: "postgres" }>) {
    this.poolSize = config.poolSize || 10
  }

  async init() {
    // Use postgres package which is a native JavaScript PostgreSQL client
    // that works well with Bun
    const postgres = await import("postgres").catch(() => {
      throw new Error(
        "PostgreSQL driver requires 'postgres' package. Install it with: bun add postgres",
      )
    })

    this.sql = postgres.default(this.config.url, {
      max: this.poolSize,
    })

    await this.createTables()
    await this.runMigrations()
  }

  private async createTables() {
    await this.sql`
      CREATE TABLE IF NOT EXISTS storage (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_storage_type ON storage(type)
    `

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_storage_created_at ON storage(created_at)
    `

    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_storage_content ON storage USING gin(content)
    `

    await this.sql`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `
  }

  private async runMigrations() {
    const result = await this.sql`SELECT COALESCE(MAX(version), 0) as version FROM migrations`
    const version = result[0]?.version || 0

    // Add future migrations here if needed
    const migrations: (() => Promise<void>)[] = []

    for (let i = version; i < migrations.length; i++) {
      this.log.info("running migration", { version: i + 1 })
      await migrations[i]()
      await this.sql`INSERT INTO migrations (version) VALUES (${i + 1})`
    }
  }

  private keyToString(key: string[]): string {
    return key.join("/")
  }

  private stringToKey(str: string): string[] {
    return str.split("/")
  }

  private getType(key: string[]): string {
    return key[0] || "unknown"
  }

  async read<T>(key: string[]): Promise<T> {
    const keyStr = this.keyToString(key)
    const result = await this.sql`SELECT content FROM storage WHERE key = ${keyStr}`

    if (result.length === 0) {
      throw new NotFoundError({ message: `Resource not found: ${keyStr}` })
    }

    return result[0].content as T
  }

  async write<T>(key: string[], content: T): Promise<void> {
    const keyStr = this.keyToString(key)
    const type = this.getType(key)

    await this.sql`
      INSERT INTO storage (key, type, content, updated_at) 
      VALUES (${keyStr}, ${type}, ${JSON.stringify(content)}, NOW())
      ON CONFLICT(key) DO UPDATE SET 
        content = EXCLUDED.content,
        updated_at = EXCLUDED.updated_at
    `
  }

  async update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const content = await this.read<T>(key)
    fn(content)
    await this.write(key, content)
    return content
  }

  async list(prefix: string[]): Promise<string[][]> {
    const prefixStr = this.keyToString(prefix)
    // If prefix is empty, match all keys
    // Otherwise, match keys that start with "prefix/"
    const pattern = prefixStr ? `${prefixStr}/%` : "%"

    const result = await this.sql`
      SELECT key FROM storage WHERE key LIKE ${pattern} ORDER BY key
    `

    // Filter to ensure we only get exact prefix matches
    return result
      .map((row: { key: string }) => this.stringToKey(row.key))
      .filter((key: string[]) => {
        if (prefix.length === 0) return true
        // Ensure the key starts with the exact prefix
        for (let i = 0; i < prefix.length; i++) {
          if (key[i] !== prefix[i]) return false
        }
        return true
      })
  }

  async remove(key: string[]): Promise<void> {
    const keyStr = this.keyToString(key)
    await this.sql`DELETE FROM storage WHERE key = ${keyStr}`
  }

  async export(): Promise<StorageDriver.ExportData> {
    const result = await this.sql`SELECT key, type, content FROM storage ORDER BY key`

    const data: StorageDriver.ExportData = {
      version: 1,
      timestamp: Date.now(),
      projects: [],
      sessions: [],
      messages: [],
      parts: [],
      session_diffs: [],
    }

    for (const row of result) {
      const key = this.stringToKey(row.key)
      const content = row.content
      const item = { key, content }

      switch (row.type) {
        case "project":
          data.projects.push(item)
          break
        case "session":
          data.sessions.push(item)
          break
        case "message":
          data.messages.push(item)
          break
        case "part":
          data.parts.push(item)
          break
        case "session_diff":
          data.session_diffs.push(item)
          break
        default:
          if (!data[row.type]) {
            data[row.type] = []
          }
          data[row.type].push(item)
      }
    }

    return data
  }

  async import(data: StorageDriver.ExportData): Promise<void> {
    await this.sql.begin(async (sql: any) => {
      const categories = [
        { key: "projects", items: data.projects },
        { key: "sessions", items: data.sessions },
        { key: "messages", items: data.messages },
        { key: "parts", items: data.parts },
        { key: "session_diffs", items: data.session_diffs },
      ]

      for (const { items } of categories) {
        for (const item of items) {
          const keyStr = this.keyToString(item.key)
          const type = this.getType(item.key)
          await sql`
            INSERT INTO storage (key, type, content, updated_at) 
            VALUES (${keyStr}, ${type}, ${JSON.stringify(item.content)}, NOW())
            ON CONFLICT(key) DO UPDATE SET 
              content = EXCLUDED.content,
              updated_at = EXCLUDED.updated_at
          `
        }
      }

      // Import other data
      for (const [key, items] of Object.entries(data)) {
        if (!["version", "timestamp", "projects", "sessions", "messages", "parts", "session_diffs"].includes(key)) {
          if (Array.isArray(items)) {
            for (const item of items) {
              const keyStr = this.keyToString(item.key)
              const type = this.getType(item.key)
              await sql`
                INSERT INTO storage (key, type, content, updated_at) 
                VALUES (${keyStr}, ${type}, ${JSON.stringify(item.content)}, NOW())
                ON CONFLICT(key) DO UPDATE SET 
                  content = EXCLUDED.content,
                  updated_at = EXCLUDED.updated_at
              `
            }
          }
        }
      }
    })
  }

  async close() {
    if (this.sql) {
      await this.sql.end()
    }
  }
}

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)
