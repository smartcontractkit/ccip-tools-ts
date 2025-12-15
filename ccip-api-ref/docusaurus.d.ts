/**
 * Docusaurus Type Declarations
 *
 * This file contains ambient module declarations for:
 * - TypeDoc-generated sidebar files (*.cjs)
 * - Docusaurus theme components (theme aliases)
 * - External dependencies used by docusaurus-plugin-openapi-docs
 *
 * Note: The OpenAPI sidebar stub is in docs-api/sidebar.d.ts because
 * TypeScript's bundler resolution requires a physical file at the import path.
 */

// =============================================================================
// TypeDoc Sidebar Files
// =============================================================================

/**
 * TypeDoc generates .cjs sidebar files that export an array of items.
 */
declare module '*.cjs' {
  interface SidebarDocItem {
    type: 'doc'
    id: string
    label: string
  }

  interface SidebarCategoryItem {
    type: 'category'
    label: string
    items: SidebarDocItem[]
  }

  type SidebarItem = SidebarDocItem | SidebarCategoryItem
  const items: SidebarItem[]
  export default items
}

// =============================================================================
// Docusaurus Theme Components
// =============================================================================

/**
 * Virtual modules resolved by Docusaurus at build time.
 */
declare module '@theme/ApiItem' {
  import type { Props } from '@docusaurus/types'
  import type React from 'react'

  export interface ApiItemProps extends Props {
    readonly content: {
      readonly metadata: {
        readonly id: string
        readonly title: string
        readonly description?: string
        readonly permalink: string
      }
    }
  }

  const ApiItem: React.ComponentType<ApiItemProps>
  export default ApiItem
}

declare module '@theme-original/ApiItem' {
  import type { ComponentType } from 'react'

  const ApiItem: ComponentType<Record<string, unknown>>
  export default ApiItem
}

// =============================================================================
// External Dependencies (docusaurus-plugin-openapi-docs)
// =============================================================================

/**
 * These declarations satisfy TypeScript when checking docusaurus-plugin-openapi-docs
 * which ships with .ts source files that reference internal Docusaurus modules.
 */

declare module 'postman-collection' {
  const Request: unknown
  export default Request
}

declare module '@docusaurus/plugin-content-docs/lib/sidebars/types' {
  export interface SidebarItemDoc {
    type: 'doc'
    id: string
    label?: string
  }

  export interface SidebarItemCategory {
    type: 'category'
    label: string
    items: SidebarItem[]
    collapsed?: boolean
  }

  export interface SidebarItemLink {
    type: 'link'
    label: string
    href: string
  }

  export type SidebarItem = SidebarItemDoc | SidebarItemCategory | SidebarItemLink

  // Additional exports needed by docusaurus-plugin-openapi-docs
  export interface PropSidebarItemCategory {
    type: 'category'
    label: string
    items: PropSidebarItem[]
    collapsed?: boolean
    collapsible?: boolean
  }

  export interface PropSidebar {
    name: string
    items: PropSidebarItem[]
  }

  export type PropSidebarItem = PropSidebarItemCategory | SidebarItemDoc | SidebarItemLink
}

declare module '@docusaurus/plugin-content-docs/src/sidebars/types' {
  export interface SidebarItemDoc {
    type: 'doc'
    id: string
    label?: string
  }

  export interface SidebarItemCategory {
    type: 'category'
    label: string
    items: SidebarItem[]
    collapsed?: boolean
  }

  export interface SidebarItemLink {
    type: 'link'
    label: string
    href: string
  }

  export type SidebarItem = SidebarItemDoc | SidebarItemCategory | SidebarItemLink
}

declare module '@docusaurus/plugin-content-docs-types' {
  export interface PropVersionMetadata {
    version: string
    label: string
    isLast: boolean
    docsSidebars: Record<string, unknown>
  }

  export interface PropSidebar {
    name: string
    items: PropSidebarItem[]
  }

  export interface PropSidebarItemCategory {
    type: 'category'
    label: string
    items: PropSidebarItem[]
    collapsed?: boolean
    collapsible?: boolean
  }

  export interface PropSidebarItemDoc {
    type: 'doc'
    id: string
    label: string
  }

  export interface SidebarItemLink {
    type: 'link'
    label: string
    href: string
  }

  export type PropSidebarItem = PropSidebarItemCategory | PropSidebarItemDoc | SidebarItemLink
}
