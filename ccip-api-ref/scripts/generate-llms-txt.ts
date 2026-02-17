#!/usr/bin/env npx ts-node
/**
 * Auto-generates llms.txt from source code - NO hardcoded content
 *
 * Extracts from:
 * - SDK: index.ts exports, chain.ts methods (FULL signatures)
 * - CLI: command files (yargs definitions)
 * - API: OpenAPI spec from https://api.ccip.chain.link/api-docs.json (FULL details)
 * - Docs: filesystem structure
 * - Architecture: Mermaid diagram from Architecture.tsx
 */

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const ROOT_DIR = path.join(__dirname, '..')
const SDK_DIR = path.join(ROOT_DIR, '..', 'ccip-sdk', 'src')
const CLI_DIR = path.join(ROOT_DIR, '..', 'ccip-cli', 'src')
const ARCHITECTURE_FILE = path.join(
  ROOT_DIR,
  'src',
  'components',
  'homepage',
  'Architecture',
  'Architecture.tsx',
)
const OUTPUT_FILE = path.join(ROOT_DIR, 'static', 'llms.txt')

// ============================================================================
// Architecture Diagram - Extract from React component
// ============================================================================

function extractMermaidDiagram(): string | null {
  if (!fs.existsSync(ARCHITECTURE_FILE)) {
    console.warn('Architecture.tsx not found, skipping diagram')
    return null
  }

  const content = fs.readFileSync(ARCHITECTURE_FILE, 'utf-8')

  // Extract the mermaid diagram from the template literal
  const match = content.match(/const architectureDiagram = `\n([\s\S]*?)`/)
  if (!match) {
    console.warn('Could not extract Mermaid diagram from Architecture.tsx')
    return null
  }

  return match[1].trim()
}

// ============================================================================
// SDK Extraction - Parse actual source files
// ============================================================================

interface ExportInfo {
  name: string
  kind: 'class' | 'function' | 'type' | 'enum' | 'const'
  from?: string
}

/**
 * Extract individual error class names from errors/index.ts
 * This provides 100% automated extraction - no hardcoded error names
 */
function extractErrorClasses(): ExportInfo[] {
  const errorsIndexPath = path.join(SDK_DIR, 'errors', 'index.ts')
  if (!fs.existsSync(errorsIndexPath)) return []

  const content = fs.readFileSync(errorsIndexPath, 'utf-8')
  const errors: ExportInfo[] = []

  // Extract all: export { ErrorClass, ... } from './specialized.ts' or './CCIPError.ts'
  const errorExports = content.matchAll(/export\s*\{\s*([^}]+)\s*\}\s*from\s*['"]([^'"]+)['"]/g)

  for (const match of errorExports) {
    const names = match[1].split(',').map((n) => n.trim().replace(/^type\s+/, ''))
    for (const name of names) {
      // Only include actual error classes (ending with Error)
      if (name.endsWith('Error') && !name.startsWith('type ')) {
        errors.push({ name, kind: 'class', from: match[2] })
      }
    }
  }

  return errors
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

  // For star exports from errors, we now extract individual classes
  // instead of generic "CCIPError (+ subclasses)"
  const starExports = content.matchAll(/export\s*\*\s*from\s*['"]([^'"]+)['"]/g)
  for (const match of starExports) {
    if (match[1].includes('error')) {
      // Extract individual error classes from errors/index.ts
      const errorClasses = extractErrorClasses()
      exports.push(...errorClasses)
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

  // Match method declarations in the Chain class - capture FULL signature
  const methodPattern =
    /^\s+(async\s+)?(abstract\s+)?(\w+)\s*(<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*([^\n{]+))?/gm

  let match
  while ((match = methodPattern.exec(content)) !== null) {
    const isAsync = !!match[1]
    const isAbstract = !!match[2]
    const name = match[3]
    const generics = match[4] || ''
    const params = match[5]?.trim() || ''
    const returnType = match[6]?.trim().replace(/\s+/g, ' ') || 'void'

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

    // Build FULL signature without truncation
    const fullSignature = `${name}${generics}(${params}): ${returnType}`

    methods.push({
      name,
      signature: fullSignature,
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
// API Extraction - Fetch and parse OpenAPI spec (FULL details)
// ============================================================================

interface APIParameter {
  name: string
  in: string
  required: boolean
  type: string
  description: string
}

interface APIEndpoint {
  method: string
  path: string
  summary: string
  description: string
  tags: string[]
  parameters: APIParameter[]
  requestBody?: string
  responses: { status: string; description: string }[]
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
        Record<
          string,
          {
            summary?: string
            description?: string
            tags?: string[]
            parameters?: Array<{
              name: string
              in: string
              required?: boolean
              schema?: { type?: string }
              description?: string
            }>
            requestBody?: {
              content?: Record<string, { schema?: { $ref?: string; type?: string } }>
            }
            responses?: Record<string, { description?: string }>
          }
        >
      >
    }

    for (const [pathStr, methods] of Object.entries(spec.paths)) {
      for (const [method, details] of Object.entries(methods)) {
        if (method === 'parameters') continue // Skip path-level parameters

        // Extract parameters
        const parameters: APIParameter[] = (details.parameters || []).map((p) => ({
          name: p.name,
          in: p.in,
          required: p.required || false,
          type: p.schema?.type || 'string',
          description: p.description || '',
        }))

        // Extract request body schema reference
        let requestBody: string | undefined
        if (details.requestBody?.content) {
          const jsonContent = details.requestBody.content['application/json']
          if (jsonContent?.schema?.$ref) {
            requestBody = jsonContent.schema.$ref.split('/').pop()
          } else if (jsonContent?.schema?.type) {
            requestBody = jsonContent.schema.type
          }
        }

        // Extract responses
        const responses: { status: string; description: string }[] = []
        if (details.responses) {
          for (const [status, resp] of Object.entries(details.responses)) {
            responses.push({
              status,
              description: resp.description || '',
            })
          }
        }

        endpoints.push({
          method: method.toUpperCase(),
          path: pathStr,
          summary: details.summary || '',
          description: details.description || '',
          tags: details.tags || [],
          parameters,
          requestBody,
          responses,
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
    { dir: 'docs-cli', section: 'CLI', basePath: '/cli/' },
    { dir: 'docs-cli/guides', section: 'CLI Guides', basePath: '/cli/guides/' },
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
  console.log('Extracting Mermaid diagram...')
  const mermaidDiagram = extractMermaidDiagram()

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
> For CCIP protocol details (glossary, message lifecycle, architecture): https://docs.chain.link/ccip/llms-full.txt

## Overview

CCIP Tools is a TypeScript toolkit for Chainlink CCIP (Cross-Chain Interoperability Protocol).

- **SDK Package:** \`@chainlink/ccip-sdk\`
- **CLI Package:** \`@chainlink/ccip-cli\`
- **REST API:** https://api.ccip.chain.link

---

## CCIP Protocol Reference

For detailed information about CCIP concepts, refer to the official documentation:

- **Glossary** (chainSelector, OnRamp, OffRamp, Lane, DON): https://docs.chain.link/ccip/llms-full.txt
- **Message Lifecycle** (Sent → Committed → Blessed → Success/Failed): https://docs.chain.link/ccip/llms-full.txt
- **Architecture**: https://docs.chain.link/ccip/llms-full.txt

---

## Tools Architecture (SDK, CLI, API)

${
  mermaidDiagram
    ? `The following Mermaid diagram shows the dependencies between SDK, CLI, and CCIP API:

\`\`\`mermaid
${mermaidDiagram}
\`\`\`
`
    : '(Architecture diagram not available)'
}

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

## Chain Methods (Full Signatures)

Methods available on chain instances (EVMChain, SolanaChain, AptosChain, SuiChain, TONChain):

${chainMethods
  .map((m) => {
    const prefix = m.isAbstract ? '[abstract] ' : ''
    const asyncPrefix = m.isAsync ? 'async ' : ''
    return `### \`${prefix}${asyncPrefix}${m.signature}\``
  })
  .join('\n\n')}

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

${apiEndpoints
  .map((e) => {
    let section = `### \`${e.method} ${e.path}\`\n\n`
    section += `**Summary:** ${e.summary}\n\n`

    if (e.description) {
      section += `**Description:** ${e.description}\n\n`
    }

    if (e.parameters.length > 0) {
      section += `**Parameters:**\n\n| Name | In | Type | Required | Description |\n|------|-----|------|----------|-------------|\n`
      section += e.parameters
        .map(
          (p) =>
            `| \`${p.name}\` | ${p.in} | ${p.type} | ${p.required ? 'Yes' : 'No'} | ${p.description} |`,
        )
        .join('\n')
      section += '\n\n'
    }

    if (e.requestBody) {
      section += `**Request Body:** \`${e.requestBody}\`\n\n`
    }

    if (e.responses.length > 0) {
      section += `**Responses:**\n\n`
      section += e.responses.map((r) => `- \`${r.status}\`: ${r.description}`).join('\n')
      section += '\n'
    }

    return section
  })
  .join('\n')}

---

## Documentation Links

${docStructure
  .map((s) => {
    return `### ${s.section}\n\n${s.files.map((f) => `- [${f.title}](https://docs.chain.link/ccip/tools${f.path})`).join('\n')}\n`
  })
  .join('\n')}

---

## Quick Links

- **GitHub:** https://github.com/smartcontractkit/ccip-tools-ts
- **npm (SDK):** https://www.npmjs.com/package/@chainlink/ccip-sdk
- **npm (CLI):** https://www.npmjs.com/package/@chainlink/ccip-cli
- **CCIP Explorer:** https://ccip.chain.link
- **API Documentation:** https://api.ccip.chain.link/api-docs
- **CCIP Protocol Docs:** https://docs.chain.link/ccip
- **Full CCIP LLM Context:** https://docs.chain.link/ccip/llms-full.txt
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
