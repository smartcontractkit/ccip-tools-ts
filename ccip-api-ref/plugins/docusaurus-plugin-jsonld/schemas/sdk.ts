/**
 * SDK schema generator
 */

import type { JsonLdPluginOptions, PageMetadata, TechArticle } from '../types.ts'
import { generateOrganization } from './common.ts'

/**
 * Generate TechArticle schema for SDK documentation
 * SDK docs typically document classes, functions, and types
 */
export function generateSdkSchema(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): TechArticle {
  const organization = generateOrganization(options)

  return {
    '@context': 'https://schema.org',
    '@type': 'TechArticle',
    headline: metadata.title,
    description: metadata.description || `${metadata.title} - SDK reference documentation`,
    url: `${baseUrl}${metadata.permalink}`,
    author: organization,
    publisher: organization,
  }
}

/**
 * Generate enhanced TechArticle with code metadata
 * Used for pages with code examples or API references
 */
export function generateSdkCodeSchema(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): TechArticle & { programmingLanguage?: string } {
  const baseSchema = generateSdkSchema(metadata, baseUrl, options)

  return {
    ...baseSchema,
    programmingLanguage: options.defaults?.programmingLanguage || 'TypeScript',
  }
}
