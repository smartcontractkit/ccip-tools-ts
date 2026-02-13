import type { SidebarsConfig } from '@docusaurus/plugin-content-docs'

import apiSidebar from './docs-api/sidebar'
import apiSidebarV1 from './docs-api/v1/sidebar'

const sidebars: SidebarsConfig = {
  apiSidebar: apiSidebar,
  apiSidebarV1: apiSidebarV1,
}

export default sidebars
