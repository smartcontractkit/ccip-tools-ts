#!/usr/bin/env node
/**
 * Post-processing script for API docs generation.
 *
 * This script runs after `docusaurus gen-api-docs all` and restores:
 * 1. The custom v2 intro page from templates/
 * 2. The custom v1 intro page from templates/
 * 3. The v1 sidebar type declaration for TypeScript
 *
 * These files are stored in templates/ to survive `clean-api`.
 */

import { copyFile } from 'node:fs/promises'
import { join } from 'node:path'

const TEMPLATES_DIR = 'templates'

/**
 * Copy custom template files to their destinations
 */
async function restoreCustomFiles() {
  const customFiles = [
    {
      src: join(TEMPLATES_DIR, 'ccip-api-v2.info.mdx'),
      dest: 'docs-api/ccip-api.info.mdx',
    },
    {
      src: join(TEMPLATES_DIR, 'ccip-api-v1.info.mdx'),
      dest: 'docs-api/v1/ccip-api.info.mdx',
    },
    {
      src: join(TEMPLATES_DIR, 'v1-sidebar.d.ts'),
      dest: 'docs-api/v1/sidebar.d.ts',
    },
  ]

  for (const { src, dest } of customFiles) {
    try {
      await copyFile(src, dest)
      console.log(`Restored: ${dest} (from ${src})`)
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.warn(`Warning: Template not found: ${src}`)
      } else {
        throw error
      }
    }
  }
}

async function main() {
  console.log('Post-processing API docs...\n')

  // Restore custom files from templates
  console.log('Restoring custom files...')
  await restoreCustomFiles()

  console.log('\nDone!')
}

main().catch((error) => {
  console.error('Error:', error)
  process.exit(1)
})
