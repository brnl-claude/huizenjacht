// Prints the newest release of frontend/src/changelog.ts.
// Usage: node changelog-notes.mjs version           -> 0.2.0
//        node changelog-notes.mjs android-version   -> newest version with Android changes (a new APK)
//        node changelog-notes.mjs notes             -> Markdown list of its changes
import { readFileSync } from 'node:fs'

const src = readFileSync('frontend/src/changelog.ts', 'utf8')
const starts = [...src.matchAll(/version:\s*['"](\d+\.\d+\.\d+)['"]/g)]
if (starts.length === 0) {
  console.error('No version found in frontend/src/changelog.ts')
  process.exit(1)
}
const blocks = starts.map((m, i) => ({
  version: m[1],
  text: src.slice(m.index, starts[i + 1] ? starts[i + 1].index : src.length),
}))

function list(block, field) {
  const found = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\n\\s*\\],?`).exec(block)
  const items = []
  if (found) {
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
    for (const m of found[1].matchAll(re)) {
      items.push((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'))
    }
  }
  return items
}

const command = process.argv[2]
if (command === 'version') {
  console.log(blocks[0].version)
} else if (command === 'android-version') {
  const android = blocks.find((b) => list(b.text, 'android').length > 0)
  if (!android) {
    console.error('No version with android changes in frontend/src/changelog.ts')
    process.exit(1)
  }
  console.log(android.version)
} else {
  const block = blocks[0].text
  const title = /title:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/.exec(block)
  const heading = title ? `${(title[1] ?? title[2]).replace(/\\(.)/g, '$1')}\n\n` : ''
  let notes = heading + list(block, 'changes').map((i) => `- ${i}`).join('\n')
  const android = list(block, 'android')
  if (android.length) {
    notes += `\n\n**Nieuwe Android-app** (huizenjacht.apk)\n\n${android.map((i) => `- ${i}`).join('\n')}`
  }
  console.log(notes)
}
