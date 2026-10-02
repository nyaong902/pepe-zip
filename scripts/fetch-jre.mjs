// OpenJDK (Azul Zulu) JRE 8 을 resources/jre/<platform>-<arch>/ 로 받아온다.
//   node scripts/fetch-jre.mjs            → 현재 OS/아키텍처만
//   node scripts/fetch-jre.mjs --all      → win/mac/linux 전부 (배포용)
//   node scripts/fetch-jre.mjs darwin-arm64
import { mkdir, writeFile, rm, readdir, rename, chmod, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const JRE_BASE = join(ROOT, 'resources', 'jre')
const CACHE = join(ROOT, '.cache', 'jre')

const BASE = 'https://cdn.azul.com/zulu/bin'
const VER = 'zulu8.96.0.205-ca-jre8.0.504'

const TARGETS = {
  'darwin-arm64': { file: `${VER}-macosx_aarch64.tar.gz`, kind: 'tar' },
  'darwin-x64': { file: `${VER}-macosx_x64.tar.gz`, kind: 'tar' },
  'win32-x64': { file: `${VER}-win_x64.zip`, kind: 'zip' },
  // Windows ARM64 용 Java 8 은 어느 배포처(Azul·BellSoft·Adoptium)에도 없다 → x64 JRE 를 넣고
  // Windows 11 ARM 의 x64 에뮬레이션으로 실행한다 (네이티브 ARM64 는 Java 11+ 부터만 있음)
  'win32-arm64': { file: `${VER}-win_x64.zip`, kind: 'zip' },
  'linux-x64': { file: `${VER}-linux_x64.tar.gz`, kind: 'tar' },
  'linux-arm64': { file: `${VER}-linux_aarch64.tar.gz`, kind: 'tar' }
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr?.toString() || r.error}`)
  return r
}

async function fetchJreTarget(key) {
  const t = TARGETS[key]
  if (!t) throw new Error(`지원하지 않는 대상: ${key} (가능: ${Object.keys(TARGETS).join(', ')})`)

  const outDir = join(JRE_BASE, key)
  const exeName = key.startsWith('win') ? 'java.exe' : 'java'
  const testCandidate = join(outDir, 'bin', exeName)
  const testCandidateMac = join(outDir, 'Contents', 'Home', 'bin', exeName)

  if (existsSync(testCandidate) || existsSync(testCandidateMac)) {
    console.log(`✓ JRE ${key} (이미 있음)`)
    return
  }

  await mkdir(CACHE, { recursive: true })
  await mkdir(outDir, { recursive: true })

  const url = `${BASE}/${t.file}`
  const cacheFile = join(CACHE, t.file)

  if (!existsSync(cacheFile) || (await stat(cacheFile)).size === 0) {
    process.stdout.write(`  ↓ JRE 8 (${key}) ... `)
    const res = await fetch(url, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`)
    const buf = Buffer.from(await res.arrayBuffer())
    await writeFile(cacheFile, buf)
    console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`)
  }

  console.log(`● ${key} 압축 푸는 중...`)
  const tmpExtract = join(CACHE, `extract-${key}`)
  await rm(tmpExtract, { recursive: true, force: true })
  await mkdir(tmpExtract, { recursive: true })

  if (t.kind === 'zip') {
    run('tar', ['-xf', cacheFile, '-C', tmpExtract])
  } else {
    run('tar', ['-xzf', cacheFile, '-C', tmpExtract])
  }

  // 최상위 디렉터리(예: zulu8.96.0.205-ca-jre8.0.504-macosx_aarch64) 내용물 이동
  const items = await readdir(tmpExtract)
  const rootFolder = items.find((f) => !f.startsWith('.'))
  const fromDir = rootFolder ? join(tmpExtract, rootFolder) : tmpExtract

  const subItems = await readdir(fromDir)
  for (const item of subItems) {
    await rename(join(fromDir, item), join(outDir, item))
  }

  await rm(tmpExtract, { recursive: true, force: true })

  // 실행 권한 및 쓰기 권한 부여 (코드사인 시 필요)
  if (!key.startsWith('win')) {
    try {
      run('chmod', ['-R', 'u+w', outDir])
    } catch { /* ignore */ }
  }
  const binDir = existsSync(join(outDir, 'bin')) ? join(outDir, 'bin') : join(outDir, 'Contents', 'Home', 'bin')
  const finalJava = join(binDir, exeName)
  if (existsSync(finalJava)) {
    if (!key.startsWith('win')) {
      await chmod(finalJava, 0o755)
    }
  }

  console.log(`✓ JRE ${key} → resources/jre/${key}`)
}

const args = process.argv.slice(2)
const keys = args.includes('--all')
  ? Object.keys(TARGETS)
  : args.length
    ? args
    : [`${os.platform()}-${os.arch()}`]

try {
  for (const k of keys) {
    await fetchJreTarget(k)
  }
} catch (e) {
  console.error('✗', e.message)
  process.exit(1)
}
