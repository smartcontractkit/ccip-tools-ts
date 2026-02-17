/**
 * JSON-LD Plugin Types
 */

export interface JsonLdPluginOptions {
  /** Organization information for schema.org */
  organization: {
    name: string
    url: string
    logo?: string
  }
  /** Default values for generated schemas */
  defaults?: {
    /** Application category for SoftwareApplication schema */
    applicationCategory?: string
    /** Operating system for SoftwareApplication schema */
    operatingSystem?: string
    /** Programming language for SDK docs */
    programmingLanguage?: string
  }
  /** Route-based schema type mapping */
  routeSchemas?: {
    /** Route prefix to schema type mapping */
    [routePrefix: string]: 'cli' | 'api' | 'sdk' | 'article'
  }
}

export interface PageMetadata {
  title: string
  description?: string
  permalink: string
  frontMatter?: Record<string, unknown>
  version?: string
}

export interface SchemaOrgBase {
  '@context': 'https://schema.org'
  '@type': string | string[]
}

export interface Organization {
  '@type': 'Organization'
  name: string
  url: string
  logo?: string
}

export interface BreadcrumbList {
  '@type': 'BreadcrumbList'
  itemListElement: BreadcrumbItem[]
}

export interface BreadcrumbItem {
  '@type': 'ListItem'
  position: number
  name: string
  item: string
}

export interface SoftwareApplication extends SchemaOrgBase {
  '@type': 'SoftwareApplication'
  name: string
  description?: string
  url: string
  applicationCategory?: string
  operatingSystem?: string
  softwareVersion?: string
  provider?: Organization
}

export interface TechArticle extends SchemaOrgBase {
  '@type': 'TechArticle'
  headline: string
  description?: string
  url: string
  author?: Organization
  publisher?: Organization
  dateModified?: string
}

export interface WebAPI extends SchemaOrgBase {
  '@type': 'WebAPI'
  name: string
  description?: string
  url: string
  documentation?: string
  provider?: Organization
}

export interface JsonLdGraph {
  '@context': 'https://schema.org'
  '@graph': (SoftwareApplication | TechArticle | WebAPI | BreadcrumbList)[]
}
