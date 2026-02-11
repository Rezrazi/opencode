import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { JsonDriver } from "../src/storage/json-driver"
import { SqliteDriver } from "../src/storage/sqlite-driver"
import path from "path"
import fs from "fs/promises"
import os from "os"

describe("Storage Drivers", () => {
  let tempDir: string

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-test-"))
  })

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  describe("JsonDriver", () => {
    test("should read and write data", async () => {
      const driver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-test"),
      })
      await driver.init()

      const testData = { id: "test-1", name: "Test Project" }
      await driver.write(["project", "test-1"], testData)

      const result = await driver.read<typeof testData>(["project", "test-1"])
      expect(result).toEqual(testData)
    })

    test("should list keys", async () => {
      const driver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-list"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1" })
      await driver.write(["project", "proj-2"], { id: "proj-2" })
      await driver.write(["session", "proj-1", "sess-1"], { id: "sess-1" })

      const projects = await driver.list(["project"])
      expect(projects.length).toBe(2)
      expect(projects).toContainEqual(["project", "proj-1"])
      expect(projects).toContainEqual(["project", "proj-2"])
    })

    test("should update data atomically", async () => {
      const driver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-update"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1", count: 0 })
      
      await driver.update<{ id: string; count: number }>(["project", "proj-1"], (draft) => {
        draft.count = 5
      })

      const result = await driver.read<{ id: string; count: number }>(["project", "proj-1"])
      expect(result.count).toBe(5)
    })

    test("should remove data", async () => {
      const driver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-remove"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1" })
      await driver.remove(["project", "proj-1"])

      const keys = await driver.list(["project"])
      expect(keys.length).toBe(0)
    })

    test("should export and import data", async () => {
      const sourceDriver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-export-source"),
      })
      await sourceDriver.init()

      await sourceDriver.write(["project", "proj-1"], { id: "proj-1", name: "Project 1" })
      await sourceDriver.write(["session", "proj-1", "sess-1"], { id: "sess-1", title: "Session 1" })

      const exportData = await sourceDriver.export()
      expect(exportData.projects.length).toBe(1)
      expect(exportData.sessions.length).toBe(1)

      const destDriver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "json-export-dest"),
      })
      await destDriver.init()

      await destDriver.import(exportData)

      const project = await destDriver.read(["project", "proj-1"])
      expect(project).toEqual({ id: "proj-1", name: "Project 1" })

      const session = await destDriver.read(["session", "proj-1", "sess-1"])
      expect(session).toEqual({ id: "sess-1", title: "Session 1" })
    })
  })

  describe("SqliteDriver", () => {
    test("should read and write data", async () => {
      const driver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-test.db"),
      })
      await driver.init()

      const testData = { id: "test-1", name: "Test Project" }
      await driver.write(["project", "test-1"], testData)

      const result = await driver.read<typeof testData>(["project", "test-1"])
      expect(result).toEqual(testData)

      await driver.close()
    })

    test("should list keys", async () => {
      const driver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-list.db"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1" })
      await driver.write(["project", "proj-2"], { id: "proj-2" })
      await driver.write(["session", "proj-1", "sess-1"], { id: "sess-1" })

      const projects = await driver.list(["project"])
      expect(projects.length).toBe(2)
      expect(projects).toContainEqual(["project", "proj-1"])
      expect(projects).toContainEqual(["project", "proj-2"])

      await driver.close()
    })

    test("should update data atomically", async () => {
      const driver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-update.db"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1", count: 0 })
      
      await driver.update<{ id: string; count: number }>(["project", "proj-1"], (draft) => {
        draft.count = 5
      })

      const result = await driver.read<{ id: string; count: number }>(["project", "proj-1"])
      expect(result.count).toBe(5)

      await driver.close()
    })

    test("should remove data", async () => {
      const driver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-remove.db"),
      })
      await driver.init()

      await driver.write(["project", "proj-1"], { id: "proj-1" })
      await driver.remove(["project", "proj-1"])

      const keys = await driver.list(["project"])
      expect(keys.length).toBe(0)

      await driver.close()
    })

    test("should export and import data", async () => {
      const sourceDriver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-export-source.db"),
      })
      await sourceDriver.init()

      await sourceDriver.write(["project", "proj-1"], { id: "proj-1", name: "Project 1" })
      await sourceDriver.write(["session", "proj-1", "sess-1"], { id: "sess-1", title: "Session 1" })

      const exportData = await sourceDriver.export()
      expect(exportData.projects.length).toBe(1)
      expect(exportData.sessions.length).toBe(1)

      const destDriver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "sqlite-export-dest.db"),
      })
      await destDriver.init()

      await destDriver.import(exportData)

      const project = await destDriver.read(["project", "proj-1"])
      expect(project).toEqual({ id: "proj-1", name: "Project 1" })

      const session = await destDriver.read(["session", "proj-1", "sess-1"])
      expect(session).toEqual({ id: "sess-1", title: "Session 1" })

      await sourceDriver.close()
      await destDriver.close()
    })

    test("should migrate from JSON to SQLite", async () => {
      const jsonDriver = new JsonDriver({
        driver: "json",
        path: path.join(tempDir, "migration-json"),
      })
      await jsonDriver.init()

      await jsonDriver.write(["project", "proj-1"], { id: "proj-1", name: "Project 1" })
      await jsonDriver.write(["session", "proj-1", "sess-1"], { id: "sess-1", title: "Session 1" })
      await jsonDriver.write(["message", "sess-1", "msg-1"], { id: "msg-1", content: "Hello" })

      const exportData = await jsonDriver.export()

      const sqliteDriver = new SqliteDriver({
        driver: "sqlite",
        database: path.join(tempDir, "migration.db"),
      })
      await sqliteDriver.init()
      await sqliteDriver.import(exportData)

      const project = await sqliteDriver.read(["project", "proj-1"])
      expect(project).toEqual({ id: "proj-1", name: "Project 1" })

      const session = await sqliteDriver.read(["session", "proj-1", "sess-1"])
      expect(session).toEqual({ id: "sess-1", title: "Session 1" })

      const message = await sqliteDriver.read(["message", "sess-1", "msg-1"])
      expect(message).toEqual({ id: "msg-1", content: "Hello" })

      await sqliteDriver.close()
    })
  })
})
