import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

import apiSidebar from './docs-api/sidebar'
import apiSidebarV1 from './docs-api/v1/sidebar'

// Hand-written guide (templates/migrate-from-v1.mdx), placed right after the generated intro
const migrationGuide = { type: 'doc' as const, id: 'migrate-from-v1' }

const sidebars: SidebarsConfig = {
  apiSidebar: Array.isArray(apiSidebar)
    ? [...apiSidebar.slice(0, 1), migrationGuide, ...apiSidebar.slice(1)]
    : apiSidebar,
  apiSidebarV1: apiSidebarV1,
}

export default sidebars
