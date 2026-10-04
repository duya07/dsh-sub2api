import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const builtFiles = ['index.js', 'index.d.ts', 'client.js']
if (builtFiles.every(name => existsSync(join(root, 'lib', name)))) process.exit(0)
if (!existsSync(join(root, 'src', 'index.ts'))) process.exit(0)
const tsdown = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['--no-install', 'tsdown'], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
if (tsdown.status !== 0) process.exit(tsdown.status ?? 1)
const wrap = spawnSync(process.execPath, [join(root, 'scripts', 'wrap-client.mjs')], { cwd: root, stdio: 'inherit' })
process.exit(wrap.status ?? 1)
