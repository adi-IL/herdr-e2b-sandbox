import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import test from "node:test"

const script = fileURLToPath(new URL("../src/exec.js", import.meta.url))

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "herdr-exec-test-"))
  t.after(() => rm(root, { recursive: true, force: true }))
  const state = path.join(root, "state")
  const config = path.join(root, "config")
  const home = path.join(root, "home")
  await Promise.all([mkdir(path.join(state, "boxes"), { recursive: true }), mkdir(config), mkdir(home)])
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(E2B_|HERDR_|XDG_)/.test(key)))
  Object.assign(env, { HOME: home, HERDR_PLUGIN_STATE_DIR: state, HERDR_PLUGIN_CONFIG_DIR: config })
  return {
    state,
    config,
    run: (payload) => new Promise((resolve) => {
      execFile(process.execPath, [script, payload], { env }, (error, stdout, stderr) => {
        resolve({ code: error?.code ?? 0, stdout, stderr })
      })
    }),
  }
}

function assertError(result, pattern) {
  assert.equal(result.code, 1)
  const out = JSON.parse(result.stdout)
  assert.deepEqual(out, { ok: false, exitCode: null, stdout: "", stderr: "", error: out.error })
  assert.match(out.error, pattern)
  assert.equal(result.stderr, "")
}

test("invalid JSON and missing or invalid fields produce one JSON error", async (t) => {
  const { run } = await fixture(t)
  assertError(await run("not-a-json"), /invalid JSON payload/)
  for (const payload of [null, {}, [], { key: {}, cmd: "true" }, { key: "probe", cmd: 123 }]) {
    assertError(await run(JSON.stringify(payload)), /need a box key and a command/)
  }
})

test("invalid timeout values produce JSON instead of throwing during coercion", async (t) => {
  const { run } = await fixture(t)
  for (const timeoutMs of [{ valueOf: null, toString: null }, [], true, "", "abc", "Infinity", 0, -1, 1.5]) {
    assertError(await run(JSON.stringify({ key: "probe", cmd: "true", timeoutMs })), /timeoutMs must be a positive integer/)
  }
})

test("missing and malformed records retain the no-sandbox JSON error", async (t) => {
  const { run, state } = await fixture(t)
  const payload = JSON.stringify({ key: "probe", cmd: "true", timeoutMs: "1000" })
  assertError(await run(payload), /no sandbox tracked/)
  await writeFile(path.join(state, "boxes/probe.json"), "not-json")
  assertError(await run(payload), /no sandbox tracked/)
})

test("missing credentials and invalid configuration produce JSON before connecting", async (t) => {
  const { run, state, config } = await fixture(t)
  await writeFile(path.join(state, "boxes/probe.json"), JSON.stringify({ sandboxId: "unused-test-box" }))
  const payload = JSON.stringify({ key: "probe", cmd: "true" })
  assertError(await run(payload), /No E2B API key/)
  await writeFile(path.join(config, "config.toml"), '[sandbox]\nregion = "invalid-region"\n')
  assertError(await run(payload), /Unknown \[sandbox\] region/)
})
