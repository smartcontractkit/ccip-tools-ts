/**
 * Docusaurus Plugin: JSON-LD Structured Data
 *
 * Automatically generates Schema.org JSON-LD structured data for all pages.
 * Supports CLI commands (SoftwareApplication), API endpoints (WebAPI),
 * SDK documentation (TechArticle), and general articles.
 */

import type { LoadContext, Plugin } from '@docusaurus/types'

import { generateApiArticleSchema, generateApiSchema } from './schemas/api.ts'
import { generateCliArticleSchema, generateCliCommandSchema } from './schemas/cli.ts'
import { detectSchemaType, generateBreadcrumbs, generateOrganization } from './schemas/common.ts'
import { generateSdkSchema } from './schemas/sdk.ts'
import type { JsonLdGraph, JsonLdPluginOptions, PageMetadata, TechArticle } from './types.ts'

/**
 * Default plugin options
 */
const defaultOptions: Partial<JsonLdPluginOptions> = {
  defaults: {
    applicationCategory: 'DeveloperApplication',
    operatingSystem: 'Cross-platform',
    programmingLanguage: 'TypeScript',
  },
  routeSchemas: {
    '/cli': 'cli',
    '/api': 'api',
    '/sdk': 'sdk',
  },
}

/**
 * Generate JSON-LD structured data based on page type
 */
function generateJsonLd(
  metadata: PageMetadata,
  baseUrl: string,
  options: JsonLdPluginOptions,
): JsonLdGraph {
  const schemaType = detectSchemaType(metadata.permalink, options.routeSchemas)
  const breadcrumbs = generateBreadcrumbs(metadata.permalink, baseUrl)

  const graph: JsonLdGraph['@graph'] = []

  switch (schemaType) {
    case 'cli': {
      // CLI pages get SoftwareApplication + TechArticle
      const softwareApp = generateCliCommandSchema(metadata, baseUrl, options)
      const techArticle = generateCliArticleSchema(metadata, baseUrl, options)

      // Remove @context from nested schemas (will use @graph context)
      const { '@context': _1, ...softwareAppClean } = softwareApp
      const { '@context': _2, ...techArticleClean } = techArticle

      graph.push(softwareAppClean as typeof softwareApp)
      graph.push(techArticleClean as typeof techArticle)
      break
    }

    case 'api': {
      // API pages get WebAPI + TechArticle
      const webApi = generateApiSchema(metadata, baseUrl, options)
      const techArticle = generateApiArticleSchema(metadata, baseUrl, options)

      const { '@context': _1, ...webApiClean } = webApi
      const { '@context': _2, ...techArticleClean } = techArticle

      graph.push(webApiClean as typeof webApi)
      graph.push(techArticleClean as typeof techArticle)
      break
    }

    case 'sdk': {
      // SDK pages get TechArticle
      const techArticle = generateSdkSchema(metadata, baseUrl, options)
      const { '@context': _, ...techArticleClean } = techArticle
      graph.push(techArticleClean as typeof techArticle)
      break
    }

    default: {
      // Default article schema
      const organization = generateOrganization(options)
      const defaultArticle: Omit<TechArticle, '@context'> = {
        '@type': 'TechArticle',
        headline: metadata.title,
        description: metadata.description,
        url: `${baseUrl}${metadata.permalink}`,
        author: organization,
        publisher: organization,
      }
      graph.push(defaultArticle as TechArticle)
    }
  }

  // Always add breadcrumbs
  graph.push(breadcrumbs)

  return {
    '@context': 'https://schema.org',
    '@graph': graph,
  }
}

/**
 * Docusaurus plugin entry point
 */
export default function jsonLdPlugin(
  context: LoadContext,
  userOptions: JsonLdPluginOptions,
): Plugin {
  // Merge user options with defaults
  const options: JsonLdPluginOptions = {
    ...defaultOptions,
    ...userOptions,
    defaults: {
      ...defaultOptions.defaults,
      ...userOptions.defaults,
    },
    routeSchemas: {
      ...defaultOptions.routeSchemas,
      ...userOptions.routeSchemas,
    },
  }

  const { siteConfig } = context
  const baseUrl = siteConfig.url + (siteConfig.baseUrl || '')

  return {
    name: 'docusaurus-plugin-jsonld',

    /**
     * Inject JSON-LD script tag into page head
     */
    injectHtmlTags({ content }) {
      // Extract metadata from content if available
      // Note: In Docusaurus, content structure varies by page type
      const metadata = extractMetadata(content)

      if (!metadata) {
        return {}
      }

      const jsonLd = generateJsonLd(metadata, baseUrl.replace(/\/$/, ''), options)

      return {
        headTags: [
          {
            tagName: 'script',
            attributes: {
              type: 'application/ld+json',
            },
            innerHTML: JSON.stringify(jsonLd, null, 0),
          },
        ],
      }
    },
  }
}

/**
 * Extract page metadata from Docusaurus content
 */
function extractMetadata(content: unknown): PageMetadata | null {
  if (!content || typeof content !== 'object') {
    return null
  }

  const doc = content as Record<string, unknown>

  // Handle doc pages
  if (doc.metadata && typeof doc.metadata === 'object') {
    const meta = doc.metadata as Record<string, unknown>
    return {
      title: (meta.title as string) || '',
      description: meta.description as string | undefined,
      permalink: (meta.permalink as string) || '',
      frontMatter: meta.frontMatter as Record<string, unknown> | undefined,
      version: meta.version as string | undefined,
    }
  }

  // Handle blog posts and other content types
  if (doc.title && doc.permalink) {
    return {
      title: doc.title as string,
      description: doc.description as string | undefined,
      permalink: doc.permalink as string,
    }
  }

  return null
}

// Re-export types for consumers
export type { JsonLdPluginOptions } from './types.ts'
