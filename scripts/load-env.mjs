/**
 * Зарежда променливи от .env и по избор .env.local (локалният презаписва).
 * Не инсталира dotenv пакет — минимален парсер за KEY=value редове.
 */
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
export const projectRoot = resolve(__dirname, '..')

/**
 * @param {string} [root]
 */
export function loadDotEnv(root = projectRoot) {
  function applyFile(relPath, override) {
    const p = resolve(root, relPath)
    if (!existsSync(p)) return
    const raw = readFileSync(p, 'utf8')
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!m || m[1].startsWith('#')) continue
      let v = m[2].replace(/^["']|["']$/g, '')
      if (override || process.env[m[1]] === undefined) process.env[m[1]] = v
    }
  }
  applyFile('.env', false)
  applyFile('.env.local', true)
}
