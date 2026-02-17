/**
 * OpenAPI Extractor
 *
 * Extracts content from OpenAPI-generated pages using the OpenAPI spec directly
 * for cleaner, more structured markdown output.
 */

import type { ExtractedContent } from './types.ts'

// Cache the OpenAPI spec to avoid repeated fetches
let cachedSpec: OpenAPISpec | null = null
let specFetchPromise: Promise<OpenAPISpec | null> | null = null

interface OpenAPISpec {
  openapi: string
  info: {
    title: string
    version: string
    description?: string
  }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, PathItem | undefined>
  components?: {
    schemas?: Record<string, SchemaObject>
  }
}

interface PathItem {
  get?: Operation
  post?: Operation
  put?: Operation
  delete?: Operation
  patch?: Operation
  summary?: string
  description?: string
}

interface Operation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: Parameter[]
  requestBody?: RequestBody
  responses?: Record<string, Response>
  tags?: string[]
}

interface Parameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: SchemaObject
}

interface RequestBody {
  description?: string
  required?: boolean
  content?: Record<string, MediaType>
}

interface Response {
  description?: string
  content?: Record<string, MediaType>
}

interface MediaType {
  schema?: SchemaObject
  example?: unknown
}

interface SchemaObject {
  type?: string
  format?: string
  description?: string
  properties?: Record<string, SchemaObject>
  items?: SchemaObject
  required?: string[]
  enum?: string[]
  example?: unknown
  pattern?: string
  minimum?: number
  maximum?: number
  allOf?: SchemaObject[]
  oneOf?: SchemaObject[]
  anyOf?: SchemaObject[]
  $ref?: string
  title?: string
}

const OPENAPI_SPEC_URL = 'https://api.ccip.chain.link/api-docs.json'

/**
 * Checks if the current page is an OpenAPI-generated endpoint page
 */
export function isOpenApiPage(): boolean {
  // Check for OpenAPI-specific elements/classes
  const hasOpenApiHeading = document.querySelector('.openapi__heading') !== null
  const hasMethodEndpoint = document.querySelector('[class*="openapi-method"]') !== null
  const hasOpenApiTabs = document.querySelector('.openapi-tabs__container') !== null
  const hasApiExplorer = document.querySelector('[class*="api-explorer"]') !== null

  // Check URL pattern - API pages typically have /api/ in the path
  const isApiPath = window.location.pathname.includes('/api/')

  // It's an OpenAPI page if it has OpenAPI elements AND is in the API path
  // But exclude the intro page which might not have endpoint-specific content
  const isIntroPage =
    window.location.pathname.endsWith('/api/') || window.location.pathname.endsWith('/api')

  return (
    (hasOpenApiHeading || hasMethodEndpoint || hasOpenApiTabs || hasApiExplorer) &&
    isApiPath &&
    !isIntroPage
  )
}

/**
 * Fetches and caches the OpenAPI spec
 */
async function fetchOpenApiSpec(): Promise<OpenAPISpec | null> {
  if (cachedSpec) {
    return cachedSpec
  }

  if (specFetchPromise) {
    return specFetchPromise
  }

  specFetchPromise = fetch(OPENAPI_SPEC_URL)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch OpenAPI spec: ${response.status}`)
      }
      return response.json()
    })
    .then((spec: OpenAPISpec) => {
      cachedSpec = spec
      return spec
    })
    .catch((error) => {
      console.error('[OpenAPI Extractor] Error fetching spec:', error)
      specFetchPromise = null
      return null
    })

  return specFetchPromise
}

/**
 * Maps the current URL to an OpenAPI endpoint path
 */
function getEndpointFromUrl(pathname: string): { path: string; method: string } | null {
  // Extract the endpoint slug from the URL
  // e.g., /ccip/tools/api/get-lane-latency -> get-lane-latency
  const match = pathname.match(/\/api\/([^/]+)$/)
  if (!match) return null

  const slug = match[1]

  // Map common slug patterns to OpenAPI paths and methods
  // The docusaurus-openapi-docs plugin generates slugs like "get-lane-latency" from "GET /lanes/latency"
  // These must match the exact paths in https://api.ccip.chain.link/api-docs.json
  const slugMappings: Record<string, { path: string; method: string } | undefined> = {
    'get-lane-latency': { path: '/lanes/latency', method: 'get' },
    'get-message': { path: '/message/{messageId}', method: 'get' },
    'get-intent-quote': { path: '/intents/quotes', method: 'post' },
    'get-intent-by-id': { path: '/intents/id/{intentId}', method: 'get' },
    'get-intents-by-tx-hash': { path: '/intents/tx/{txHash}', method: 'get' },
  }

  return slugMappings[slug] ?? null
}

/**
 * Extracts content from an OpenAPI page using the spec
 */
export async function extractOpenApiContent(): Promise<ExtractedContent | null> {
  try {
    const spec = await fetchOpenApiSpec()
    if (!spec) {
      console.warn(
        '[OpenAPI Extractor] Could not fetch OpenAPI spec, falling back to HTML extraction',
      )
      return null
    }

    const endpoint = getEndpointFromUrl(window.location.pathname)
    if (!endpoint) {
      console.warn('[OpenAPI Extractor] Could not map URL to endpoint')
      return null
    }

    const pathItem = spec.paths[endpoint.path]
    if (!pathItem) {
      console.warn(`[OpenAPI Extractor] Path not found in spec: ${endpoint.path}`)
      return null
    }

    const operation = pathItem[endpoint.method as keyof PathItem] as Operation | undefined
    if (!operation) {
      console.warn(
        `[OpenAPI Extractor] Method ${endpoint.method} not found for path ${endpoint.path}`,
      )
      return null
    }

    // Get base URL from spec
    const baseUrl = spec.servers?.[0]?.url || 'https://api.ccip.chain.link/v1'

    // Generate markdown from the operation
    const markdown = generateMarkdownFromOperation(
      endpoint.path,
      endpoint.method.toUpperCase(),
      operation,
      baseUrl,
      spec.components?.schemas,
    )

    // Get title from operation or page
    /* eslint-disable @typescript-eslint/no-unnecessary-condition -- DOM textContent may be null */
    const title =
      operation.summary || document.querySelector('h1')?.textContent?.trim() || 'API Endpoint'
    /* eslint-enable @typescript-eslint/no-unnecessary-condition */

    return {
      markdown: addFrontmatter(markdown, title),
      title,
      url: window.location.href,
      timestamp: new Date(),
    }
  } catch (error) {
    console.error('[OpenAPI Extractor] Error extracting content:', error)
    return null
  }
}

/**
 * Generates clean markdown from an OpenAPI operation
 */
function generateMarkdownFromOperation(
  path: string,
  method: string,
  operation: Operation,
  baseUrl: string,
  schemas?: Record<string, SchemaObject>,
): string {
  const lines: string[] = []

  // Title
  lines.push(`# ${operation.summary || path}`)
  lines.push('')

  // Method and URL
  lines.push('```')
  lines.push(`${method} ${baseUrl}${path}`)
  lines.push('```')
  lines.push('')

  // Description
  if (operation.description) {
    lines.push(operation.description)
    lines.push('')
  }

  // Parameters
  if (operation.parameters && operation.parameters.length > 0) {
    lines.push('## Parameters')
    lines.push('')

    // Group parameters by location
    const queryParams = operation.parameters.filter((p) => p.in === 'query')
    const pathParams = operation.parameters.filter((p) => p.in === 'path')
    const headerParams = operation.parameters.filter((p) => p.in === 'header')

    if (pathParams.length > 0) {
      lines.push('### Path Parameters')
      lines.push('')
      lines.push(...formatParameters(pathParams))
      lines.push('')
    }

    if (queryParams.length > 0) {
      lines.push('### Query Parameters')
      lines.push('')
      lines.push(...formatParameters(queryParams))
      lines.push('')
    }

    if (headerParams.length > 0) {
      lines.push('### Header Parameters')
      lines.push('')
      lines.push(...formatParameters(headerParams))
      lines.push('')
    }
  }

  // Request Body
  if (operation.requestBody) {
    lines.push('## Request Body')
    lines.push('')
    if (operation.requestBody.description) {
      lines.push(operation.requestBody.description)
      lines.push('')
    }
    if (operation.requestBody.content) {
      const content = operation.requestBody.content['application/json']
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- content type may not exist
      if (content?.schema) {
        lines.push(...formatSchema(content.schema, schemas, 0))
        lines.push('')
      }
    }
  }

  // Responses
  if (operation.responses) {
    lines.push('## Responses')
    lines.push('')

    for (const [statusCode, response] of Object.entries(operation.responses)) {
      lines.push(`### ${statusCode} ${getStatusText(statusCode)}`)
      lines.push('')
      if (response.description) {
        lines.push(response.description)
        lines.push('')
      }
      if (response.content) {
        const content = response.content['application/json']
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- content type may not exist
        if (content?.schema) {
          lines.push('**Response Schema:**')
          lines.push('')
          lines.push(...formatSchema(content.schema, schemas, 0))
          lines.push('')
        }
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- content type may not exist
        if (content?.example) {
          lines.push('**Example:**')
          lines.push('')
          lines.push('```json')
          lines.push(JSON.stringify(content.example, null, 2))
          lines.push('```')
          lines.push('')
        }
      }
    }
  }

  return lines.join('\n')
}

/**
 * Formats parameters into markdown
 */
function formatParameters(params: Parameter[]): string[] {
  const lines: string[] = []

  for (const param of params) {
    const required = param.required ? ' *(required)*' : ''
    const type = param.schema?.type || 'string'
    lines.push(`- **\`${param.name}\`** (${type})${required}`)

    if (param.description) {
      lines.push(`  ${param.description.replace(/\n/g, ' ').trim()}`)
    }

    if (param.schema?.pattern) {
      lines.push(`  - Pattern: \`${param.schema.pattern}\``)
    }

    if (param.schema?.example !== undefined && param.schema.example !== null) {
      const example = param.schema.example
      /* eslint-disable @typescript-eslint/no-unnecessary-condition -- typeof null === 'object' in JS */
      const exampleStr =
        typeof example === 'object' && example !== null
          ? JSON.stringify(example)
          : String(example as string | number | boolean)
      /* eslint-enable @typescript-eslint/no-unnecessary-condition */
      lines.push(`  - Example: \`${exampleStr}\``)
    }

    lines.push('')
  }

  return lines
}

/**
 * Formats a schema into markdown
 */
function formatSchema(
  schema: SchemaObject,
  schemas?: Record<string, SchemaObject>,
  depth: number = 0,
): string[] {
  const lines: string[] = []
  const indent = '  '.repeat(depth)

  // Handle $ref
  if (schema.$ref) {
    const refName = schema.$ref.replace('#/components/schemas/', '')
    const refSchema = schemas?.[refName]
    if (refSchema) {
      return formatSchema(refSchema, schemas, depth)
    }
    lines.push(`${indent}- Reference: ${refName}`)
    return lines
  }

  // Handle allOf
  if (schema.allOf) {
    for (const subSchema of schema.allOf) {
      lines.push(...formatSchema(subSchema, schemas, depth))
    }
    return lines
  }

  // Handle object type
  if (schema.type === 'object' && schema.properties) {
    for (const [propName, propSchema] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(propName) ? ' *(required)*' : ''
      const type = propSchema.type || 'object'
      lines.push(`${indent}- **\`${propName}\`** (${type})${required}`)

      if (propSchema.description) {
        lines.push(`${indent}  ${propSchema.description.replace(/\n/g, ' ').trim()}`)
      }

      if (propSchema.pattern) {
        lines.push(`${indent}  - Pattern: \`${propSchema.pattern}\``)
      }

      if (propSchema.example !== undefined && propSchema.example !== null) {
        const example = propSchema.example
        /* eslint-disable @typescript-eslint/no-unnecessary-condition -- typeof null === 'object' in JS */
        const exampleStr =
          typeof example === 'object' && example !== null
            ? JSON.stringify(example)
            : String(example as string | number | boolean)
        /* eslint-enable @typescript-eslint/no-unnecessary-condition */
        lines.push(`${indent}  - Example: \`${exampleStr}\``)
      }

      // Handle nested objects
      if (propSchema.type === 'object' && propSchema.properties) {
        lines.push(...formatSchema(propSchema, schemas, depth + 1))
      }

      // Handle allOf in properties
      if (propSchema.allOf) {
        lines.push(...formatSchema(propSchema, schemas, depth + 1))
      }
    }
  }

  // Handle array type
  if (schema.type === 'array' && schema.items) {
    lines.push(`${indent}  - Items:`)
    lines.push(...formatSchema(schema.items, schemas, depth + 1))
  }

  return lines
}

/**
 * Gets human-readable status text for HTTP status codes
 */
function getStatusText(statusCode: string): string {
  const statusTexts: Record<string, string> = {
    '200': 'OK',
    '201': 'Created',
    '204': 'No Content',
    '400': 'Bad Request',
    '401': 'Unauthorized',
    '403': 'Forbidden',
    '404': 'Not Found',
    '500': 'Internal Server Error',
  }
  return statusTexts[statusCode] || ''
}

/**
 * Adds frontmatter to the markdown content
 */
function addFrontmatter(markdown: string, title: string): string {
  return `---
title: "${title}"
source: ${window.location.href}
extracted: ${new Date().toISOString()}
---

${markdown}`
}
