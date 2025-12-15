/**
 * Common schema utilities for JSON-LD generation
 */

import type { BreadcrumbItem, BreadcrumbList, JsonLdPluginOptions, Organization } from '../types.ts'

/**
 * Generate organization schema
 */
export function generateOrganization(options: JsonLdPluginOptions): Organization {
  return {
    '@type': 'Organization',
    name: options.organization.name,
    url: options.organization.url,
    ...(options.organization.logo && { logo: options.organization.logo }),
  }
}

/**
 * Generate breadcrumb list from permalink
 * @param permalink - Page permalink like /cli/show or /api/messages/get
 * @param baseUrl - Site base URL
 */
export function generateBreadcrumbs(permalink: string, baseUrl: string): BreadcrumbList {
  const segments = permalink.split('/').filter(Boolean)
  const items: BreadcrumbItem[] = []

  let currentPath = baseUrl

  segments.forEach((segment, index) => {
    currentPath = `${currentPath}/${segment}`
    items.push({
      '@type': 'ListItem',
      position: index + 1,
      name: formatBreadcrumbName(segment),
      item: currentPath,
    })
  })

  return {
    '@type': 'BreadcrumbList',
    itemListElement: items,
  }
}

/**
 * Format segment name for breadcrumb display
 */
function formatBreadcrumbName(segment: string): string {
  // Map common route segments to display names
  const nameMap: Record<string, string> = {
    cli: 'CLI',
    api: 'API',
    sdk: 'SDK',
    docs: 'Documentation',
  }

  if (nameMap[segment.toLowerCase()]) {
    return nameMap[segment.toLowerCase()]
  }

  // Convert kebab-case to Title Case
  return segment
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Detect schema type from route
 */
export function detectSchemaType(
  permalink: string,
  routeSchemas?: JsonLdPluginOptions['routeSchemas'],
): 'cli' | 'api' | 'sdk' | 'article' {
  // Check custom route mappings first
  if (routeSchemas) {
    for (const [prefix, type] of Object.entries(routeSchemas)) {
      if (permalink.startsWith(prefix)) {
        return type
      }
    }
  }

  // Default detection based on route
  if (permalink.startsWith('/cli')) return 'cli'
  if (permalink.startsWith('/api')) return 'api'
  if (permalink.startsWith('/sdk')) return 'sdk'

  return 'article'
}
