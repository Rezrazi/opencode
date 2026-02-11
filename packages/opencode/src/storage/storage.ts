import { Log } from "../util/log"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { lazy } from "../util/lazy"
import { StorageDriver } from "./driver"
import { JsonDriver, NotFoundError as JsonNotFoundError } from "./json-driver"
import { SqliteDriver, NotFoundError as SqliteNotFoundError } from "./sqlite-driver"
import { PostgresDriver, NotFoundError as PostgresNotFoundError } from "./postgres-driver"
import { Config } from "../config/config"

export namespace Storage {
  const log = Log.create({ service: "storage" })

  export const NotFoundError = NamedError.create(
    "NotFoundError",
    z.object({
      message: z.string(),
    }),
  )

  /**
   * Create a storage driver based on configuration
   */
  async function createDriver(): Promise<StorageDriver.Driver> {
    const config = await Config.state()
    const storageConfig = config.storage || { driver: "json" as const }

    log.info("initializing storage driver", { driver: storageConfig.driver })

    let driver: StorageDriver.Driver

    switch (storageConfig.driver) {
      case "json":
        driver = new JsonDriver(storageConfig)
        break
      case "sqlite":
        driver = new SqliteDriver(storageConfig)
        break
      case "postgres":
        driver = new PostgresDriver(storageConfig)
        break
      default:
        throw new Error(`Unknown storage driver: ${(storageConfig as any).driver}`)
    }

    await driver.init()
    return driver
  }

  const driverInstance = lazy(createDriver)

  export async function remove(key: string[]) {
    const driver = await driverInstance()
    return driver.remove(key)
  }

  export async function read<T>(key: string[]) {
    const driver = await driverInstance()
    return driver.read<T>(key)
  }

  export async function update<T>(key: string[], fn: (draft: T) => void) {
    const driver = await driverInstance()
    return driver.update<T>(key, fn)
  }

  export async function write<T>(key: string[], content: T) {
    const driver = await driverInstance()
    return driver.write<T>(key, content)
  }

  export async function list(prefix: string[]) {
    const driver = await driverInstance()
    return driver.list(prefix)
  }

  /**
   * Export all data from the current storage driver
   */
  export async function exportAll(): Promise<StorageDriver.ExportData> {
    const driver = await driverInstance()
    return driver.export()
  }

  /**
   * Import data into the current storage driver
   */
  export async function importAll(data: StorageDriver.ExportData): Promise<void> {
    const driver = await driverInstance()
    return driver.import(data)
  }

  /**
   * Close the storage driver and cleanup resources
   */
  export async function close(): Promise<void> {
    const driver = await driverInstance()
    if (driver.close) {
      await driver.close()
    }
  }
}
