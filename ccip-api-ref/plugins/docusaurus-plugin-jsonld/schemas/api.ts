/**
 * API schema generator
 */

import type { JsonLdPluginOptions, PageMetadata, TechArticle, WebAPI } from '../types.ts'
import { generateOrganization } from './common.ts'

/**
 * Generate WebAPI schema for API endpoint documentation
 */
export function generateApiSchema(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): WebAPI {
  const organization = generateOrganization(options)

  return {
    '@context': 'https://schema.org',
    '@type': 'WebAPI',
    name: metadata.title,
    description: metadata.description,
    url: `${baseUrl}${metadata.permalink}`,
    documentation: `${baseUrl}${metadata.permalink}`,
    provider: organization,
  }
}

/**
 * Generate TechArticle schema for API documentation
 */
export function generateApiArticleSchema(
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
