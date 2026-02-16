#!/usr/bin/env npx ts-node
/**
 * Auto-generates llms.txt from source code - NO hardcoded content
 *
 * Extracts from:
 * - SDK: index.ts exports, chain.ts methods, types.ts enums
 * - CLI: command files (yargs definitions)
 * - API: OpenAPI spec from https://api.ccip.chain.link/api-docs.json
 * - Docs: filesystem structure
 */

import * as fs from 'fs'
import * as path from 'path'

const ROOT_DIR = path.join(__dirname, '..')
const SDK_DIR = path.join(ROOT_DIR, '..', 'ccip-sdk', 'src')
const CLI_DIR = path.join(ROOT_DIR, '..', 'ccip-cli', 'src')
const OUTPUT_FILE = path.join(ROOT_DIR, 'static', 'llms.txt')

// ============================================================================
// SDK Extraction - Parse actual source files
// ============================================================================

interface ExportInfo {
  name: string
  kind: 'class' | 'function' | 'type' | 'enum' | 'const'
  from?: string
}

function extractSDKExports(): ExportInfo[] {
  const indexPath = path.join(SDK_DIR, 'index.ts')
  if (!fs.existsSync(indexPath)) return []

  const content = fs.readFileSync(indexPath, 'utf-8')
  const exports: ExportInfo[] = []

  // Extract: export { Name } from './file'
  const namedExports = content.matchAll(/export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g)
  for (const match of namedExports) {
    const names = match[1].split(',').map((n) =>
      n
        .trim()
        .split(/\s+as\s+/)
        .pop()!
        .trim(),
    )
    const from = match[2]
    for (const name of names) {
      if (name.startsWith('type ')) continue // Skip type-only exports in this pass
      const cleanName = name.replace(/^type\s+/, '')
      if (/^[A-Z]/.test(cleanName)) {
        // Heuristic: PascalCase = class/type, camelCase = function
        exports.push({
          name: cleanName,
          kind: cleanName.endsWith('Error') ? 'class' : 'type',
          from,
        })
      } else {
        exports.push({ name: cleanName, kind: 'function', from })
      }
    }
  }

  // Extract: export type { Name } from './file'
  const typeExports = content.matchAll(
    /export\s+type\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g,
  )
  for (const match of typeExports) {
    const names = match[1].split(',').map((n) => n.trim())
    const from = match[2]
    for (const name of names) {
      exports.push({ name, kind: 'type', from })
    }
  }

  // Extract: export { ClassName }  (classes at bottom of file)
  const classExports = content.matchAll(/export\s*\{\s*([\w\s,]+)\s*\}(?!\s*from)/g)
  for (const match of classExports) {
    const names = match[1]
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean)
    for (const name of names) {
      if (/Chain$/.test(name)) {
        exports.push({ name, kind: 'class' })
      } else if (/^[A-Z]/.test(name)) {
        exports.push({ name, kind: 'enum' })
      }
    }
  }

  // Extract: export * from './errors/index'
  const starExports = content.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)
  for (const match of starExports) {
    if (match[1].includes('error')) {
      exports.push({ name: 'CCIPError (+ subclasses)', kind: 'class', from: match[1] })
    }
  }

  return exports
}

interface MethodInfo {
  name: string
  signature: string
  isAbstract: boolean
  isAsync: boolean
}

function extractChainMethods(): MethodInfo[] {
  const chainPath = path.join(SDK_DIR, 'chain.ts')
  if (!fs.existsSync(chainPath)) return []

  const content = fs.readFileSync(chainPath, 'utf-8')
  const methods: MethodInfo[] = []

  // Match method declarations in the Chain class
  // Pattern: (async)? (abstract)? methodName(params): ReturnType
  const methodPattern =
    /^\s+(async\s+)?(abstract\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\n{]+))?/gm

  let match
  while ((match = methodPattern.exec(content)) !== null) {
    const isAsync = !!match[1]
    const isAbstract = !!match[2]
    const name = match[3]
    const params = match[5]?.trim() || ''
    const returnType = match[6]?.trim() || 'void'

    // Skip constructor, private methods, internal methods
    if (name === 'constructor' || name.startsWith('_') || name === 'destroy') continue
    // Skip if it's not a method (keywords, control flow)
    if (
      [
        'if',
        'for',
        'while',
        'switch',
        'catch',
        'return',
        'async',
        'await',
        'function',
        'const',
        'let',
        'var',
      ].includes(name)
    )
      continue

    methods.push({
      name,
      signature: `${name}(${params.length > 50 ? '...' : params}): ${returnType.replace(/\n/g, ' ').slice(0, 50)}`,
      isAbstract,
      isAsync,
    })
  }

  // Deduplicate by name (keep first occurrence)
  const seen = new Set<string>()
  return methods.filter((m) => {
    if (seen.has(m.name)) return false
    seen.add(m.name)
    return true
  })
}

// ============================================================================
// CLI Extraction - Parse yargs command definitions
// ============================================================================

interface CLICommand {
  name: string
  aliases: string[]
  describe: string
  options: { name: string; alias?: string; describe: string; required: boolean }[]
  positionals: { name: string; describe: string; required: boolean }[]
}

function extractCLICommands(): CLICommand[] {
  const commandsDir = path.join(CLI_DIR, 'commands')
  if (!fs.existsSync(commandsDir)) return []

  const commands: CLICommand[] = []
  const files = fs
    .readdirSync(commandsDir)
    .filter((f) => f.endsWith('.ts') && !f.includes('.test.'))

  for (const file of files) {
    if (file === 'index.ts' || file === 'types.ts' || file === 'utils.ts') continue

    const filePath = path.join(commandsDir, file)
    const content = fs.readFileSync(filePath, 'utf-8')

    // Extract command name
    const commandMatch = content.match(
      /export\s+const\s+command\s*=\s*(?:\[([^\]]+)\]|['"]([^'"]+)['"])/,
    )
    if (!commandMatch) continue

    let name: string
    let aliases: string[] = []

    if (commandMatch[1]) {
      // Array format: ['show <tx-hash>', '* <tx-hash>']
      const parts = commandMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, ''))
      name = parts[0].split(/\s+/)[0]
      aliases = parts
        .slice(1)
        .map((p) => p.split(/\s+/)[0])
        .filter((a) => a !== '*')
    } else {
      name = commandMatch[2]
    }

    // Extract describe
    const describeMatch = content.match(/export\s+const\s+describe\s*=\s*['"]([^'"]+)['"]/)
    const describe = describeMatch ? describeMatch[1] : ''

    // Extract aliases if separate
    const aliasesMatch = content.match(/export\s+const\s+aliases\s*=\s*\[([^\]]*)\]/)
    if (aliasesMatch) {
      aliases = aliasesMatch[1]
        .split(',')
        .map((a) => a.trim().replace(/['"]/g, ''))
        .filter(Boolean)
    }

    // Extract options from builder
    const options: CLICommand['options'] = []
    const positionals: CLICommand['positionals'] = []

    // Positional arguments
    const positionalMatches = content.matchAll(
      /\.positional\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{([^}]+)\}/g,
    )
    for (const pm of positionalMatches) {
      const pname = pm[1]
      const pconfig = pm[2]
      const descMatch = pconfig.match(/describe:\s*['"]([^'"]+)['"]/)
      const requiredMatch = pconfig.match(/demandOption:\s*true/)
      positionals.push({
        name: pname,
        describe: descMatch ? descMatch[1] : '',
        required: !!requiredMatch,
      })
    }

    // Options - .option('name', { ... })
    const optionMatches = content.matchAll(/\.option\s*\(\s*['"]([^'"]+)['"]\s*,\s*\{([^}]+)\}/g)
    for (const om of optionMatches) {
      const oname = om[1]
      const oconfig = om[2]
      const aliasMatch = oconfig.match(/alias:\s*(?:\[([^\]]+)\]|['"]([^'"]+)['"])/)
      const descMatch = oconfig.match(/describe:\s*['"]([^'"]+)['"]/)
      const requiredMatch = oconfig.match(/demandOption:\s*true/)

      let alias: string | undefined
      if (aliasMatch) {
        alias = aliasMatch[1]
          ? aliasMatch[1]
              .split(',')
              .map((a) => a.trim().replace(/['"]/g, ''))
              .join(', ')
          : aliasMatch[2]
      }

      options.push({
        name: oname,
        alias,
        describe: descMatch ? descMatch[1] : '',
        required: !!requiredMatch,
      })
    }

    // Options block - .options({ name: { ... }, ... })
    const optionsBlockMatch = content.match(/\.options\s*\(\s*\{([\s\S]*?)\}\s*\)/)
    if (optionsBlockMatch) {
      const block = optionsBlockMatch[1]
      const optMatches = block.matchAll(/['"]?([\w-]+)['"]?\s*:\s*\{([^}]+)\}/g)
      for (const om of optMatches) {
        const oname = om[1]
        const oconfig = om[2]
        const aliasMatch = oconfig.match(/alias:\s*(?:\[([^\]]+)\]|['"]([^'"]+)['"])/)
        const descMatch = oconfig.match(/describe:\s*['"]([^'"]+)['"]/)
        const requiredMatch = oconfig.match(/demandOption:\s*true/)

        let alias: string | undefined
        if (aliasMatch) {
          alias = aliasMatch[1]
            ? aliasMatch[1]
                .split(',')
                .map((a) => a.trim().replace(/['"]/g, ''))
                .join(', ')
            : aliasMatch[2]
        }

        options.push({
          name: oname,
          alias,
          describe: descMatch ? descMatch[1] : '',
          required: !!requiredMatch,
        })
      }
    }

    commands.push({ name, aliases, describe, options, positionals })
  }

  return commands
}

// ============================================================================
// API Extraction - Fetch and parse OpenAPI spec
// ============================================================================

interface APIEndpoint {
  method: string
  path: string
  summary: string
  description?: string
  tags: string[]
}

async function fetchOpenAPISpec(): Promise<APIEndpoint[]> {
  const endpoints: APIEndpoint[] = []

  try {
    const response = await fetch('https://api.ccip.chain.link/api-docs.json')
    if (!response.ok) {
      console.warn('Failed to fetch OpenAPI spec:', response.status)
      return endpoints
    }

    const spec = (await response.json()) as {
      paths: Record<
        string,
        Record<string, { summary?: string; description?: string; tags?: string[] }>
      >
    }

    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const [method, details] of Object.entries(methods)) {
        if (method === 'parameters') continue // Skip path-level parameters
        endpoints.push({
          method: method.toUpperCase(),
          path,
          summary: details.summary || '',
          description: details.description,
          tags: details.tags || [],
        })
      }
    }
  } catch (err) {
    console.warn('Error fetching OpenAPI spec:', err)
  }

  return endpoints
}

// ============================================================================
// Documentation Structure - Read from filesystem
// ============================================================================

interface DocFile {
  path: string
  title: string
}

function extractDocStructure(): { section: string; basePath: string; files: DocFile[] }[] {
  const structure: { section: string; basePath: string; files: DocFile[] }[] = []

  const docDirs = [
    { dir: 'docs-sdk/guides', section: 'SDK Guides', basePath: '/sdk/guides/' },
    { dir: 'docs-sdk/classes', section: 'SDK Classes', basePath: '/sdk/classes/' },
    { dir: 'docs-sdk/functions', section: 'SDK Functions', basePath: '/sdk/functions/' },
    { dir: 'docs-sdk/type-aliases', section: 'SDK Types', basePath: '/sdk/type-aliases/' },
    { dir: 'docs-cli', section: 'CLI', basePath: '/cli/' },
    { dir: 'docs-cli/guides', section: 'CLI Guides', basePath: '/cli/guides/' },
    { dir: 'docs-api', section: 'API Endpoints', basePath: '/api/' },
  ]

  for (const { dir, section, basePath } of docDirs) {
    const fullPath = path.join(ROOT_DIR, dir)
    if (!fs.existsSync(fullPath)) continue

    const files: DocFile[] = []
    const entries = fs
      .readdirSync(fullPath)
      .filter((f) => (f.endsWith('.mdx') || f.endsWith('.md')) && !f.startsWith('_'))

    for (const entry of entries) {
      const filePath = path.join(fullPath, entry)
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) continue

      // Extract title from frontmatter or filename
      const content = fs.readFileSync(filePath, 'utf-8')
      const titleMatch = content.match(/title:\s*['"]?([^'"\n]+)['"]?/)
      const title = titleMatch ? titleMatch[1] : entry.replace(/\.(mdx|md)$/, '')

      files.push({
        path: basePath + entry.replace(/\.(mdx|md)$/, ''),
        title,
      })
    }

    if (files.length > 0) {
      structure.push({ section, basePath, files })
    }
  }

  return structure
}

// ============================================================================
// Generate llms.txt
// ============================================================================

async function generateLlmsTxt(): Promise<string> {
  console.log('Extracting SDK exports...')
  const sdkExports = extractSDKExports()

  console.log('Extracting Chain methods...')
  const chainMethods = extractChainMethods()

  console.log('Extracting CLI commands...')
  const cliCommands = extractCLICommands()

  console.log('Fetching OpenAPI spec...')
  const apiEndpoints = await fetchOpenAPISpec()

  console.log('Extracting documentation structure...')
  const docStructure = extractDocStructure()

  const now = new Date().toISOString().split('T')[0]

  // Group exports by kind, filter out empty names and duplicates
  const seen = new Set<string>()
  const dedupe = (arr: ExportInfo[]) =>
    arr.filter((e) => {
      if (!e.name || e.name === '' || seen.has(e.name)) return false
      seen.add(e.name)
      return true
    })

  const classes = dedupe(sdkExports.filter((e) => e.kind === 'class'))
  const functions = dedupe(sdkExports.filter((e) => e.kind === 'function'))
  const types = dedupe(sdkExports.filter((e) => e.kind === 'type'))
  const enums = dedupe(sdkExports.filter((e) => e.kind === 'enum'))

  let output = `# CCIP Tools Documentation

> Auto-generated context file for LLMs. Generated: ${now}

## Overview

CCIP Tools is a TypeScript toolkit for Chainlink CCIP (Cross-Chain Interoperability Protocol).

**Package:** @chainlink/ccip-sdk
**CLI:** ccip-cli
**API:** https://api.ccip.chain.link

---

## SDK Exports (@chainlink/ccip-sdk)

### Classes (${classes.length})

${classes.map((c) => `- \`${c.name}\``).join('\n')}

### Functions (${functions.length})

${functions.map((f) => `- \`${f.name}()\``).join('\n')}

### Types (${types.length})

${types.map((t) => `- \`${t.name}\``).join('\n')}

### Enums (${enums.length})

${enums.map((e) => `- \`${e.name}\``).join('\n')}

---

## Chain Methods

Methods available on chain instances (EVMChain, SolanaChain, etc.):

| Method | Abstract |
|--------|----------|
${chainMethods.map((m) => `| \`${m.signature.slice(0, 60)}${m.signature.length > 60 ? '...' : ''}\` | ${m.isAbstract ? 'Yes' : 'No'} |`).join('\n')}

---

## CLI Commands (${cliCommands.length})

${cliCommands
  .map((cmd) => {
    const aliasStr = cmd.aliases.length > 0 ? ` (aliases: ${cmd.aliases.join(', ')})` : ''
    const positionalStr =
      cmd.positionals.length > 0
        ? cmd.positionals.map((p) => (p.required ? `<${p.name}>` : `[${p.name}]`)).join(' ')
        : ''

    let section = `### \`${cmd.name}${positionalStr ? ' ' + positionalStr : ''}\`${aliasStr}\n\n${cmd.describe}\n`

    if (cmd.options.length > 0) {
      section += `\n| Option | Alias | Required | Description |\n|--------|-------|----------|-------------|\n`
      section += cmd.options
        .map(
          (o) =>
            `| \`--${o.name}\` | ${o.alias ? `\`-${o.alias}\`` : '-'} | ${o.required ? 'Yes' : 'No'} | ${o.describe} |`,
        )
        .join('\n')
      section += '\n'
    }

    return section
  })
  .join('\n')}

---

## REST API Endpoints (${apiEndpoints.length})

Base URL: \`https://api.ccip.chain.link\`

| Method | Path | Summary |
|--------|------|---------|
${apiEndpoints.map((e) => `| \`${e.method}\` | \`${e.path}\` | ${e.summary} |`).join('\n')}

---

## Documentation Structure

${docStructure
  .map((s) => {
    if (s.files.length > 20) {
      return `### ${s.section} (${s.files.length} files)\n\nBase path: \`${s.basePath}\`\n`
    }
    return `### ${s.section}\n\n${s.files.map((f) => `- [${f.title}](${f.path})`).join('\n')}\n`
  })
  .join('\n')}

---

## Links

- GitHub: https://github.com/smartcontractkit/ccip-tools-ts
- CCIP Explorer: https://ccip.chain.link
- API Docs: https://api.ccip.chain.link/api-docs
`

  return output
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log('Generating llms.txt from source code...\n')

  const content = await generateLlmsTxt()

  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  fs.writeFileSync(OUTPUT_FILE, content, 'utf-8')

  const stats = {
    lines: content.split('\n').length,
    chars: content.length,
  }

  console.log(`\nGenerated ${OUTPUT_FILE}`)
  console.log(`  Lines: ${stats.lines}`)
  console.log(`  Chars: ${stats.chars}`)
}

main().catch(console.error)
