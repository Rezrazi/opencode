import z from "zod"

/**
 * Storage driver interface for different storage backends
 * Provides a unified API for JSON, SQLite, and PostgreSQL storage
 */
export namespace StorageDriver {
  /**
   * Common interface all storage drivers must implement
   */
  export interface Driver {
    /**
     * Initialize the driver and run migrations
     */
    init(): Promise<void>

    /**
     * Read a value from storage by key path
     */
    read<T>(key: string[]): Promise<T>

    /**
     * Write a value to storage by key path
     */
    write<T>(key: string[], content: T): Promise<void>

    /**
     * Update a value atomically using a mutation function
     */
    update<T>(key: string[], fn: (draft: T) => void): Promise<T>

    /**
     * List all keys under a prefix
     */
    list(prefix: string[]): Promise<string[][]>

    /**
     * Remove a value by key path
     */
    remove(key: string[]): Promise<void>

    /**
     * Export all data from storage
     */
    export(): Promise<ExportData>

    /**
     * Import data into storage
     */
    import(data: ExportData): Promise<void>

    /**
     * Close the driver and cleanup resources
     */
    close?(): Promise<void>
  }

  /**
   * Configuration for storage drivers
   */
  export const Config = z.discriminatedUnion("driver", [
    z.object({
      driver: z.literal("json"),
      path: z.string().optional().describe("Base path for JSON files"),
    }),
    z.object({
      driver: z.literal("sqlite"),
      database: z.string().optional().describe("Path to SQLite database file"),
    }),
    z.object({
      driver: z.literal("postgres"),
      url: z.string().describe("PostgreSQL connection URL"),
      poolSize: z.number().optional().describe("Connection pool size"),
    }),
  ])

  export type Config = z.infer<typeof Config>

  /**
   * Structure for exporting/importing data between drivers
   */
  export interface ExportData {
    version: number
    timestamp: number
    projects: Record<string, any>[]
    sessions: Record<string, any>[]
    messages: Record<string, any>[]
    parts: Record<string, any>[]
    session_diffs: Record<string, any>[]
    [key: string]: any
  }

  /**
   * Metadata about storage entities
   */
  export interface EntityMeta {
    type: "project" | "session" | "message" | "part" | "session_diff" | "permission" | "share"
    key: string[]
  }
}
