import type { Argv } from "yargs"
import { cmd } from "./cmd"
import { bootstrap } from "../bootstrap"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Storage } from "../../storage/storage"
import { StorageDriver } from "../../storage/driver"
import { JsonDriver } from "../../storage/json-driver"
import { SqliteDriver } from "../../storage/sqlite-driver"
import { PostgresDriver } from "../../storage/postgres-driver"
import { Log } from "../../util/log"
import fs from "fs/promises"

export const StorageMigrateCommand = cmd({
  command: "storage:migrate",
  describe: "migrate storage between different backends",
  builder: (yargs: Argv) => {
    return yargs
      .option("from", {
        describe: "source storage driver (json, sqlite, postgres)",
        type: "string",
        choices: ["json", "sqlite", "postgres"],
      })
      .option("to", {
        describe: "destination storage driver (json, sqlite, postgres)",
        type: "string",
        choices: ["json", "sqlite", "postgres"],
      })
      .option("from-config", {
        describe: "source driver configuration (JSON string)",
        type: "string",
      })
      .option("to-config", {
        describe: "destination driver configuration (JSON string)",
        type: "string",
      })
      .option("output", {
        describe: "output file for export (when not migrating directly)",
        type: "string",
      })
  },
  handler: async (args) => {
    await bootstrap(process.cwd(), async () => {
      const log = Log.create({ service: "storage:migrate" })

      UI.empty()
      prompts.intro("Storage Migration", {
        output: process.stderr,
      })

      let sourceDriver: string | undefined = args.from
      let destDriver: string | undefined = args.to
      let sourceConfig: any
      let destConfig: any

      // Interactive mode if source or destination not specified
      if (!sourceDriver) {
        const selected = await prompts.select({
          message: "Select source storage driver",
          options: [
            { label: "JSON (file-based)", value: "json" },
            { label: "SQLite", value: "sqlite" },
            { label: "PostgreSQL", value: "postgres" },
          ],
          output: process.stderr,
        })

        if (prompts.isCancel(selected)) {
          throw new UI.CancelledError()
        }

        sourceDriver = selected as string
      }

      if (!destDriver) {
        const selected = await prompts.select({
          message: "Select destination storage driver",
          options: [
            { label: "JSON (file-based)", value: "json" },
            { label: "SQLite", value: "sqlite" },
            { label: "PostgreSQL", value: "postgres" },
          ],
          output: process.stderr,
        })

        if (prompts.isCancel(selected)) {
          throw new UI.CancelledError()
        }

        destDriver = selected as string
      }

      // Get source config
      if (args.fromConfig) {
        sourceConfig = JSON.parse(args.fromConfig)
      } else {
        sourceConfig = await getDriverConfig(sourceDriver, "source")
      }

      // Get destination config
      if (args.toConfig) {
        destConfig = JSON.parse(args.toConfig)
      } else {
        destConfig = await getDriverConfig(destDriver, "destination")
      }

      prompts.log.info(`Migrating from ${sourceDriver} to ${destDriver}`, {
        output: process.stderr,
      })

      const spinner = prompts.spinner()
      spinner.start("Exporting data from source...")

      try {
        // Create source driver
        const source = createDriver(sourceDriver, sourceConfig)
        await source.init()

        // Export data
        const data = await source.export()
        spinner.message(`Exported ${getTotalRecords(data)} records`)

        if (args.output) {
          // Save to file
          await fs.writeFile(args.output, JSON.stringify(data, null, 2))
          spinner.stop(`Data exported to ${args.output}`)
          prompts.outro("Export completed successfully", {
            output: process.stderr,
          })
          return
        }

        // Create destination driver
        spinner.message("Importing data to destination...")
        const dest = createDriver(destDriver, destConfig)
        await dest.init()

        // Import data
        await dest.import(data)

        spinner.stop("Migration completed successfully")

        prompts.outro(
          `Migrated ${getTotalRecords(data)} records from ${sourceDriver} to ${destDriver}`,
          {
            output: process.stderr,
          },
        )

        // Close drivers
        if (source.close) await source.close()
        if (dest.close) await dest.close()
      } catch (error) {
        spinner.stop("Migration failed")
        log.error("migration failed", { error })
        prompts.log.error(error instanceof Error ? error.message : String(error), {
          output: process.stderr,
        })
        prompts.outro("Migration failed", {
          output: process.stderr,
        })
        process.exit(1)
      }
    })
  },
})

async function getDriverConfig(driver: string, label: string): Promise<any> {
  const config: any = { driver }

  if (driver === "json") {
    const pathInput = await prompts.text({
      message: `Enter ${label} JSON storage path (optional, press Enter for default)`,
      placeholder: "~/.local/share/opencode/storage",
      output: process.stderr,
    })

    if (!prompts.isCancel(pathInput) && pathInput) {
      config.path = pathInput as string
    }
  } else if (driver === "sqlite") {
    const dbPath = await prompts.text({
      message: `Enter ${label} SQLite database path (optional, press Enter for default)`,
      placeholder: "~/.local/share/opencode/storage/opencode.db",
      output: process.stderr,
    })

    if (!prompts.isCancel(dbPath) && dbPath) {
      config.database = dbPath as string
    }
  } else if (driver === "postgres") {
    const url = await prompts.text({
      message: `Enter ${label} PostgreSQL connection URL`,
      placeholder: "postgres://user:pass@localhost:5432/opencode",
      output: process.stderr,
    })

    if (prompts.isCancel(url)) {
      throw new UI.CancelledError()
    }

    config.url = url as string

    const poolSize = await prompts.text({
      message: "Enter connection pool size (optional, press Enter for default 10)",
      placeholder: "10",
      output: process.stderr,
    })

    if (!prompts.isCancel(poolSize) && poolSize) {
      config.poolSize = parseInt(poolSize as string, 10)
    }
  }

  return config
}

function createDriver(type: string, config: any): StorageDriver.Driver {
  switch (type) {
    case "json":
      return new JsonDriver(config)
    case "sqlite":
      return new SqliteDriver(config)
    case "postgres":
      return new PostgresDriver(config)
    default:
      throw new Error(`Unknown driver type: ${type}`)
  }
}

function getTotalRecords(data: StorageDriver.ExportData): number {
  return (
    data.projects.length +
    data.sessions.length +
    data.messages.length +
    data.parts.length +
    data.session_diffs.length
  )
}
