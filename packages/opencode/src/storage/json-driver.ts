import { Log } from "../util/log"
import path from "path"
import fs from "fs/promises"
import { Global } from "../global"
import { Filesystem } from "../util/filesystem"
import { lazy } from "../util/lazy"
import { Lock } from "../util/lock"
import { $ } from "bun"
import { NamedError } from "@opencode-ai/util/error"
import z from "zod"
import { StorageDriver } from "./driver"

/**
 * JSON file-based storage driver
 * This is the default/legacy storage implementation
 */
export class JsonDriver implements StorageDriver.Driver {
  private log = Log.create({ service: "storage:json" })
  private statePromise: Promise<{ dir: string }>

  constructor(private config: Extract<StorageDriver.Config, { driver: "json" }>) {
    this.statePromise = this.initState()
  }

  private async initState() {
    const dir = this.config.path || path.join(Global.Path.data, "storage")
    return { dir }
  }

  async init() {
    const { dir } = await this.statePromise
    await this.runMigrations(dir)
  }

  private async runMigrations(dir: string) {
    const migration = await Bun.file(path.join(dir, "migration"))
      .json()
      .then((x) => parseInt(x))
      .catch(() => 0)

    for (let index = migration; index < MIGRATIONS.length; index++) {
      this.log.info("running migration", { index })
      const migrationFn = MIGRATIONS[index]
      await migrationFn(dir).catch(() => this.log.error("failed to run migration", { index }))
      await Bun.write(path.join(dir, "migration"), (index + 1).toString())
    }
  }

  async read<T>(key: string[]): Promise<T> {
    const { dir } = await this.statePromise
    const target = path.join(dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.read(target)
      const result = await Bun.file(target).json()
      return result as T
    })
  }

  async write<T>(key: string[], content: T): Promise<void> {
    const { dir } = await this.statePromise
    const target = path.join(dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.write(target)
      await Bun.write(target, JSON.stringify(content, null, 2))
    })
  }

  async update<T>(key: string[], fn: (draft: T) => void): Promise<T> {
    const { dir } = await this.statePromise
    const target = path.join(dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      using _ = await Lock.write(target)
      const content = await Bun.file(target).json()
      fn(content)
      await Bun.write(target, JSON.stringify(content, null, 2))
      return content as T
    })
  }

  async list(prefix: string[]): Promise<string[][]> {
    const { dir } = await this.statePromise
    const glob = new Bun.Glob("**/*")
    try {
      const result = await Array.fromAsync(
        glob.scan({
          cwd: path.join(dir, ...prefix),
          onlyFiles: true,
        }),
      ).then((results) => results.map((x) => [...prefix, ...x.slice(0, -5).split(path.sep)]))
      result.sort()
      return result
    } catch {
      return []
    }
  }

  async remove(key: string[]): Promise<void> {
    const { dir } = await this.statePromise
    const target = path.join(dir, ...key) + ".json"
    return this.withErrorHandling(async () => {
      await fs.unlink(target).catch(() => {})
    })
  }

  async export(): Promise<StorageDriver.ExportData> {
    const { dir } = await this.statePromise
    const data: StorageDriver.ExportData = {
      version: 1,
      timestamp: Date.now(),
      projects: [],
      sessions: [],
      messages: [],
      parts: [],
      session_diffs: [],
    }

    // Export projects
    const projectKeys = await this.list(["project"])
    for (const key of projectKeys) {
      const content = await this.read<any>(key)
      data.projects.push({ key, content })
    }

    // Export sessions
    const sessionKeys = await this.list(["session"])
    for (const key of sessionKeys) {
      const content = await this.read<any>(key)
      data.sessions.push({ key, content })
    }

    // Export messages
    const messageKeys = await this.list(["message"])
    for (const key of messageKeys) {
      const content = await this.read<any>(key)
      data.messages.push({ key, content })
    }

    // Export parts
    const partKeys = await this.list(["part"])
    for (const key of partKeys) {
      const content = await this.read<any>(key)
      data.parts.push({ key, content })
    }

    // Export session diffs
    const diffKeys = await this.list(["session_diff"])
    for (const key of diffKeys) {
      const content = await this.read<any>(key)
      data.session_diffs.push({ key, content })
    }

    // Export other data
    const { dir: baseDir } = await this.statePromise
    const glob = new Bun.Glob("*")
    for await (const item of glob.scan({ cwd: baseDir, onlyFiles: false })) {
      if (!["project", "session", "message", "part", "session_diff", "migration"].includes(item)) {
        const keys = await this.list([item])
        data[item] = []
        for (const key of keys) {
          const content = await this.read<any>(key)
          data[item].push({ key, content })
        }
      }
    }

    return data
  }

  async import(data: StorageDriver.ExportData): Promise<void> {
    // Import projects
    for (const item of data.projects) {
      await this.write(item.key, item.content)
    }

    // Import sessions
    for (const item of data.sessions) {
      await this.write(item.key, item.content)
    }

    // Import messages
    for (const item of data.messages) {
      await this.write(item.key, item.content)
    }

    // Import parts
    for (const item of data.parts) {
      await this.write(item.key, item.content)
    }

    // Import session diffs
    for (const item of data.session_diffs) {
      await this.write(item.key, item.content)
    }

    // Import other data
    for (const [key, items] of Object.entries(data)) {
      if (!["version", "timestamp", "projects", "sessions", "messages", "parts", "session_diffs"].includes(key)) {
        if (Array.isArray(items)) {
          for (const item of items) {
            await this.write(item.key, item.content)
          }
        }
      }
    }
  }

  private async withErrorHandling<T>(body: () => Promise<T>): Promise<T> {
    return body().catch((e) => {
      if (!(e instanceof Error)) throw e
      const errnoException = e as NodeJS.ErrnoException
      if (errnoException.code === "ENOENT") {
        throw new NotFoundError({ message: `Resource not found: ${errnoException.path}` })
      }
      throw e
    })
  }
}

// Migrations (extracted from original storage.ts)
type Migration = (dir: string) => Promise<void>

const MIGRATIONS: Migration[] = [
  async (dir) => {
    const project = path.resolve(dir, "../project")
    if (!(await Filesystem.isDir(project))) return
    const log = Log.create({ service: "storage:migration" })
    for await (const projectDir of new Bun.Glob("*").scan({
      cwd: project,
      onlyFiles: false,
    })) {
      log.info(`migrating project ${projectDir}`)
      let projectID = projectDir
      const fullProjectDir = path.join(project, projectDir)
      let worktree = "/"

      if (projectID !== "global") {
        for await (const msgFile of new Bun.Glob("storage/session/message/*/*.json").scan({
          cwd: path.join(project, projectDir),
          absolute: true,
        })) {
          const json = await Bun.file(msgFile).json()
          worktree = json.path?.root
          if (worktree) break
        }
        if (!worktree) continue
        if (!(await Filesystem.isDir(worktree))) continue
        const [id] = await $`git rev-list --max-parents=0 --all`
          .quiet()
          .nothrow()
          .cwd(worktree)
          .text()
          .then((x) =>
            x
              .split("\n")
              .filter(Boolean)
              .map((x) => x.trim())
              .toSorted(),
          )
        if (!id) continue
        projectID = id

        await Bun.write(
          path.join(dir, "project", projectID + ".json"),
          JSON.stringify({
            id,
            vcs: "git",
            worktree,
            time: {
              created: Date.now(),
              initialized: Date.now(),
            },
          }),
        )

        log.info(`migrating sessions for project ${projectID}`)
        for await (const sessionFile of new Bun.Glob("storage/session/info/*.json").scan({
          cwd: fullProjectDir,
          absolute: true,
        })) {
          const dest = path.join(dir, "session", projectID, path.basename(sessionFile))
          log.info("copying", {
            sessionFile,
            dest,
          })
          const session = await Bun.file(sessionFile).json()
          await Bun.write(dest, JSON.stringify(session))
          log.info(`migrating messages for session ${session.id}`)
          for await (const msgFile of new Bun.Glob(`storage/session/message/${session.id}/*.json`).scan({
            cwd: fullProjectDir,
            absolute: true,
          })) {
            const dest = path.join(dir, "message", session.id, path.basename(msgFile))
            log.info("copying", {
              msgFile,
              dest,
            })
            const message = await Bun.file(msgFile).json()
            await Bun.write(dest, JSON.stringify(message))

            log.info(`migrating parts for message ${message.id}`)
            for await (const partFile of new Bun.Glob(`storage/session/part/${session.id}/${message.id}/*.json`).scan({
              cwd: fullProjectDir,
              absolute: true,
            })) {
              const dest = path.join(dir, "part", message.id, path.basename(partFile))
              const part = await Bun.file(partFile).json()
              log.info("copying", {
                partFile,
                dest,
              })
              await Bun.write(dest, JSON.stringify(part))
            }
          }
        }
      }
    }
  },
  async (dir) => {
    const log = Log.create({ service: "storage:migration" })
    for await (const item of new Bun.Glob("session/*/*.json").scan({
      cwd: dir,
      absolute: true,
    })) {
      const session = await Bun.file(item).json()
      if (!session.projectID) continue
      if (!session.summary?.diffs) continue
      const { diffs } = session.summary
      await Bun.file(path.join(dir, "session_diff", session.id + ".json")).write(JSON.stringify(diffs))
      await Bun.file(path.join(dir, "session", session.projectID, session.id + ".json")).write(
        JSON.stringify({
          ...session,
          summary: {
            additions: diffs.reduce((sum: any, x: any) => sum + x.additions, 0),
            deletions: diffs.reduce((sum: any, x: any) => sum + x.deletions, 0),
          },
        }),
      )
    }
  },
]

// Error class (re-exported from storage.ts)
export const NotFoundError = NamedError.create(
  "NotFoundError",
  z.object({
    message: z.string(),
  }),
)
