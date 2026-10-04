import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

test('packaged prepare accepts complete prebuilt output without development tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sub2api-prepare-'))
  try {
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.mkdirSync(path.join(root, 'lib'))
    fs.mkdirSync(path.join(root, 'src'))
    fs.copyFileSync(new URL('../scripts/prepare.mjs', import.meta.url), path.join(root, 'scripts', 'prepare.mjs'))
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), '')
    for (const file of ['index.js', 'index.d.ts', 'client.js']) fs.writeFileSync(path.join(root, 'lib', file), '')
    const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare.mjs')], {
      env: { ...process.env, PATH: root, Path: root }, encoding: 'utf8', timeout: 10000,
    })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '')
    fs.unlinkSync(path.join(root, 'lib', 'client.js'))
    const incomplete = spawnSync(process.execPath, [path.join(root, 'scripts', 'prepare.mjs')], {
      env: { ...process.env, PATH: root, Path: root }, encoding: 'utf8', timeout: 10000,
    })
    assert.notEqual(incomplete.status, 0, 'incomplete source checkout must not silently skip its build')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
