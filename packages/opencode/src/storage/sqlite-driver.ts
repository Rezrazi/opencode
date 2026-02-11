import { Log } from "../util/log"
import path from "path"
import { Global } from "../global"
import { StorageDriver } from "./driver"
import { Database } from "bun:sqlite"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"

/**
 * SQLite storage driver using Bun's built-in SQLite
 */
export class SqliteDriver implements StorageDriver.Driver {
  private log = Log.create({ service: "storage:sqlite" })
  private db!: Database
  private dbPath: string

  constructor(private config: Extract<StorageDriver.Config, { driver: "sqlite" }>) {
    this.dbPath = config.database || path.join(Global.Path.data, "storage", "opencode.db")
  }

  async init() {
    this.db = new Database(this.dbPath, { create: true })
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    await this.createTables()
    await this.runMigrations()
  }

  private async createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage (
        key TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      ) WITHOUT ROWID
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_type ON storage(type)
    `)

    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_storage_created_at ON storage(created_at)
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS migrations (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL DEFAULT (unixepoch())
      ) WITHOUT ROWID
    `)
  }

  private async runMigrations() {
    const version = this.db.query<{ version: number }, []>("SELECT COALESCE(MAX(version), 0) as version FROM migrations").get()
      ?.version || 0

    // Add future migrations here if needed
    const migrations: (() => void)[] = []

    for (let i = version; i < migrations.length; i++) {
      this.log.info("running migration", { version: i + 1 })
      migrations[i]()
      this.db.run("INSERT INTO migrations (version) VALUES (?)", [i + 1])
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
    const row = this.db.query<{ content: string }, [string]>("SELECT content FROM storage WHERE key = ?").get(keyStr)

    if (!row) {
      throw new NotFoundError({ message: `Resource not found: ${keyStr}` })
    }

    return JSON.parse(row.content) as T
  }

  async write<T>(key: string[], content: T): Promise<void> {
    const keyStr = this.keyToString(key)
    const type = this.getType(key)
    const contentStr = JSON.stringify(content)

    this.db.run(
      `INSERT INTO storage (key, type, content, updated_at) 
       VALUES (?, ?, ?, unixepoch())
       ON CONFLICT(key) DO UPDATE SET 
         content = excluded.content,
         updated_at = excluded.updated_at`,
      [keyStr, type, contentStr],
    )
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

    const rows = this.db.query<{ key: string }, [string]>(
      "SELECT key FROM storage WHERE key LIKE ? ORDER BY key"
    ).all(pattern)

    // Filter to ensure we only get exact prefix matches
    return rows
      .map((row) => this.stringToKey(row.key))
      .filter((key) => {
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
    this.db.run("DELETE FROM storage WHERE key = ?", [keyStr])
  }

  async export(): Promise<StorageDriver.ExportData> {
    const rows = this.db.query<{ key: string; type: string; content: string }, []>("SELECT key, type, content FROM storage ORDER BY key").all()

    const data: StorageDriver.ExportData = {
      version: 1,
      timestamp: Date.now(),
      projects: [],
      sessions: [],
      messages: [],
      parts: [],
      session_diffs: [],
    }

    for (const row of rows) {
      const key = this.stringToKey(row.key)
      const content = JSON.parse(row.content)
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
    const tx = this.db.transaction((importData: StorageDriver.ExportData) => {
      const categories = [
        { key: "projects", items: importData.projects },
        { key: "sessions", items: importData.sessions },
        { key: "messages", items: importData.messages },
        { key: "parts", items: importData.parts },
        { key: "session_diffs", items: importData.session_diffs },
      ]

      for (const { items } of categories) {
        for (const item of items) {
          const keyStr = this.keyToString(item.key)
          const type = this.getType(item.key)
          const contentStr = JSON.stringify(item.content)
          this.db.run(
            `INSERT INTO storage (key, type, content, updated_at) 
             VALUES (?, ?, ?, unixepoch())
             ON CONFLICT(key) DO UPDATE SET 
               content = excluded.content,
               updated_at = excluded.updated_at`,
            [keyStr, type, contentStr],
          )
        }
      }

      // Import other data
      for (const [key, items] of Object.entries(importData)) {
        if (!["version", "timestamp", "projects", "sessions", "messages", "parts", "session_diffs"].includes(key)) {
          if (Array.isArray(items)) {
            for (const item of items) {
              const keyStr = this.keyToString(item.key)
              const type = this.getType(item.key)
              const contentStr = JSON.stringify(item.content)
              this.db.run(
                `INSERT INTO storage (key, type, content, updated_at) 
                 VALUES (?, ?, ?, unixepoch())
                 ON CONFLICT(key) DO UPDATE SET 
                   content = excluded.content,
                   updated_at = excluded.updated_at`,
                [keyStr, type, contentStr],
              )
            }
          }
        }
      }
    })

    tx(data)
  }

  async close() {
    if (this.db) {
      this.db.close()
    }
  }
}

export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)
