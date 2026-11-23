// Prints the newest release of frontend/src/changelog.ts.
// Usage: node changelog-notes.mjs version   -> 0.2.0
//        node changelog-notes.mjs notes     -> Markdown list of its changes
import { readFileSync } from 'node:fs'

const src = readFileSync('frontend/src/changelog.ts', 'utf8')
const starts = [...src.matchAll(/version:\s*['"](\d+\.\d+\.\d+)['"]/g)]
if (starts.length === 0) {
  console.error('No version found in frontend/src/changelog.ts')
  process.exit(1)
}
const first = starts[0]
const end = starts[1] ? starts[1].index : src.length
const block = src.slice(first.index, end)

if (process.argv[2] === 'version') {
  console.log(first[1])
} else {
  const list = /changes:\s*\[([\s\S]*?)\n\s*\],?/.exec(block)
  const items = []
  if (list) {
    const re = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g
    for (const m of list[1].matchAll(re)) {
      items.push((m[1] ?? m[2] ?? m[3]).replace(/\\(.)/g, '$1'))
    }
  }
  const title = /title:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")/.exec(block)
  const heading = title ? `${(title[1] ?? title[2]).replace(/\\(.)/g, '$1')}\n\n` : ''
  console.log(heading + items.map((i) => `- ${i}`).join('\n'))
}
