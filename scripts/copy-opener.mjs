import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const withoutInstallFiles = html
  .replace(/\n?\s*<link rel="manifest"[^>]*>/g, '')
  .replace(/\n?\s*<link rel="apple-touch-icon"[^>]*>/g, '')

writeFileSync(join(root, 'Abrir HealthForest.html'), withoutInstallFiles)
const descargas = join(root, 'descargas')
const app = join(descargas, 'app')
mkdirSync(join(app, 'icons'), { recursive: true })
writeFileSync(join(descargas, 'HealthForest-Portable.html'), withoutInstallFiles)
writeFileSync(join(app, 'index.html'), html)
for (const name of ['sw.js', 'manifest.webmanifest']) {
  const from = join(dist, name)
  if (existsSync(from)) copyFileSync(from, join(app, name))
}
const icons = join(dist, 'icons')
if (existsSync(icons)) cpSync(icons, join(app, 'icons'), { recursive: true })
console.log('Abrir HealthForest.html y descargas/app')
