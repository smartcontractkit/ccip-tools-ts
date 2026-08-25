#!/usr/bin/env node

const fs = require('fs/promises')
const path = require('node:path')
const { globSync } = require('node:fs')
const prettier = require('prettier')

const ROOT = path.join(__dirname, '..')

/**
 * `require` for eval'd blocks: bare ids resolve normally, relative ids resolve
 * against the repo root — the blocks historically ran with this script living at
 * the root, so e.g. `./package.json` means the root's package.json.
 */
const rootRequire = (id) =>
  require(id.startsWith('.') ? require.resolve(id, { paths: [ROOT] }) : id)

const newLineRe = /(?:\r\n|\r|\n)/g
const DRY = process.argv.includes('--dry')

/**
 * Process a file, replacing comment blocks starting with `// generate:` and ending
 * with `// generate:end` with the result of the eval of the lines in between
 **/
async function generate(filepath) {
  const file = await fs.readFile(filepath, 'utf8')
  const lines = file.split(newLineRe)
  let noFail
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (!/\s*\/\/ generate:(?:nofail)?$/.test(line)) continue
    noFail ||= line.endsWith('nofail')

    let expr = []
    for (++i; i < lines.length; i++) {
      line = lines[i]
      const match = line.match(/^\s*\/\/ (.*)$/)
      if (!match || ['generate', 'end'].every((w) => line.includes(w))) break
      expr.push(match[1])
    }

    expr = expr.join('\n')
    // Evaluate with eval semantics (completion value of the expression) in a scope
    // whose only injected binding is the root-relative `require` above.
    const runExpr = new Function('require', `return eval(${JSON.stringify(expr)})`)
    let res = await runExpr(rootRequire)
    if (typeof res === 'string') res = [res]

    const endIdx = lines.findIndex(
      (l, idx) => idx >= i && ['//', 'generate', 'end'].every((w) => l.includes(w)),
    )
    if (endIdx <= 0) throw new Error('no "// generate:end" found')

    lines.splice(i, endIdx - i, ...res)
    i = endIdx
  }
  const options = await prettier.resolveConfig(filepath)
  const newFile = await prettier.format(lines.join('\n'), { ...options, filepath })
  if (!DRY && newFile !== file) await fs.writeFile(filepath, newFile)
  return newFile !== file && (noFail ? true : -1)
}

process.argv
  .slice(2)
  .filter((param) => param !== '--dry')
  .forEach((param) => {
    for (const filepath of globSync(param)) {
      generate(filepath).then(
        (changed) => {
          if (changed == -1) process.exitCode = 1
          console.info(changed ? 'generated' : 'up-to-date', filepath)
        },
        (err) => console.error(`generate error on "${filepath}":`, err),
      )
    }
  })
