#!/usr/bin/env node

const fs = require('fs/promises')

const newLineRe = /(?:\r\n|\r|\n)/g

/**
 * Process a file, replacing comment blocks starting with `// generate:` and ending
 * with `// end:generate` with the result of the eval of the lines in between
 **/
async function generate(path) {
  const file = await fs.readFile(path, 'utf8')
  const lines = file.split(newLineRe)
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i]
    if (!/\s*\/\/ generate:$/.test(line)) continue

    let expr = []
    for (++i; i < lines.length; i++) {
      line = lines[i]
      const match = line.match(/^\s*\/\/ (.*)$/)
      if (!match || ['end', 'generate'].every((w) => line.includes(w))) break
      expr.push(match[1])
    }

    expr = expr.map((l) => l.trim()).join('')
    const res = await eval(expr)
    if (typeof res === 'string') res = [res]

    const endIdx = lines.findIndex((l, idx) => idx > i && ['//', 'end', 'generate'].every((w) => l.includes(w)))

    lines.splice(i++, Math.max(0, endIdx - i + 1), ...res)
  }
  await fs.writeFile(path, lines.join('\n'))
}

generate(process.argv[2]).catch((err) =>
  console.error('generate error:', err),
)
