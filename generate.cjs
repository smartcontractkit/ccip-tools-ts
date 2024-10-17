#!/usr/bin/env node

const fs = require('fs/promises')
const prettier = require('prettier')
const { glob } = require('glob') // FIXME: replace with fs.glob after node22 LTS

const newLineRe = /(?:\r\n|\r|\n)/g

/**
 * Process a file, replacing comment blocks starting with `// generate:` and ending
 * with `// generate:end` with the result of the eval of the lines in between
 **/
async function generate(filepath) {
  const file = await fs.readFile(filepath, 'utf8')
  const lines = file.split(newLineRe)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (!/\s*\/\/ generate:$/.test(line)) continue

    let expr = []
    for (++i; i < lines.length; i++) {
      line = lines[i]
      const match = line.match(/^\s*\/\/ (.*)$/)
      if (!match || ['generate', 'end'].every((w) => line.includes(w))) break
      expr.push(match[1])
    }

    expr = expr.join('\n')
    const res = await eval(expr)
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
  if (newFile !== file) await fs.writeFile(filepath, newFile)
  return newFile !== file
}

process.argv.slice(2).forEach(async (param) => {
  for (const filepath of await glob(param)) {
    await generate(filepath).then(
      (changed) => {
        if (changed) process.exitCode = 1
        console.info(changed ? 'generated' : 'up-to-date', filepath)
      },
      (err) => console.error('generate error:', err),
    )
  }
})
