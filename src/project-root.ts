import { access } from 'node:fs/promises'
import { join } from 'node:path'

export async function projectRoot() {
  const candidates = [process.cwd(), join(process.cwd(), '..'), '/var/task']
  for (const candidate of candidates) {
    try {
      await access(join(candidate, 'casos'))
      await access(join(candidate, 'repositorio', 'maestro.json'))
      return candidate
    } catch {
      continue
    }
  }
  return process.cwd()
}
