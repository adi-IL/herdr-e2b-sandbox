import assert from "node:assert/strict"
import { mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

const state = await mkdtemp(path.join(os.tmpdir(), "herdr-store-test-"))
process.env.HERDR_PLUGIN_STATE_DIR = state
const { BOXES_DIR, recordPath, writeRecord } = await import("../src/store.js")

test.after(() => rm(state, { recursive: true, force: true }))

test("concurrent writes to one record all finish and leave one complete record", async () => {
  const patches = Array.from({ length: 100 }, (_, value) => ({ value, body: String(value).repeat(10000) }))
  const results = await Promise.allSettled(patches.map((patch) => writeRecord("concurrent", patch)))
  assert.equal(results.filter((result) => result.status === "rejected").length, 0)

  const record = JSON.parse(await readFile(recordPath("concurrent"), "utf8"))
  assert.equal(record.key, "concurrent")
  assert.ok(patches.some((patch) => patch.value === record.value && patch.body === record.body))
  assert.deepEqual((await readdir(BOXES_DIR)).filter((name) => name.includes(".tmp.")), [])
})

test("a failed rename rejects and removes its temporary file", async () => {
  await mkdir(recordPath("blocked"), { recursive: true })
  await assert.rejects(writeRecord("blocked", { status: "ready" }))
  assert.deepEqual((await readdir(BOXES_DIR)).filter((name) => name.startsWith("blocked.json.tmp.")), [])
})
