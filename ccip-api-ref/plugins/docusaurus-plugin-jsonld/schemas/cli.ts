/**
 * CLI Command schema generator
 */

import type {
  JsonLdPluginOptions,
  PageMetadata,
  SoftwareApplication,
  TechArticle,
} from '../types.ts'
import { generateOrganization } from './common.ts'

/**
 * Generate SoftwareApplication schema for CLI command pages
 */
export function generateCliCommandSchema(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): SoftwareApplication {
  const organization = generateOrganization(options)

  // Extract version from frontMatter if available
  const version = (metadata.frontMatter?.version as string) || metadata.version || undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: `ccip-cli ${metadata.title}`,
    description: metadata.description,
    url: `${baseUrl}${metadata.permalink}`,
    applicationCategory: options.defaults?.applicationCategory || 'DeveloperApplication',
    operatingSystem: options.defaults?.operatingSystem || 'Cross-platform (Node.js 20+)',
    ...(version && { softwareVersion: version }),
    provider: organization,
  }
}

/**
 * Generate TechArticle schema for CLI documentation
 */
export function generateCliArticleSchema(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): TechArticle {
  const organization = generateOrganization(options)

  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: metadata.title,
    description: metadata.description,
    url: `${baseUrl}${metadata.permalink}`,
    author: organization,
    publisher: organization,
  }
}
