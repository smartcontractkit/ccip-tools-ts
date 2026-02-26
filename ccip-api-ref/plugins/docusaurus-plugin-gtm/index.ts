/**
 * Docusaurus Plugin: Google Tag Manager (GTM)
 *
 * Injects GTM script as high in <head> as possible and the noscript
 * fallback immediately after the opening <body> tag for full page tracking.
 */

import type { Plugin } from '@docusaurus/types'

const GTM_ID = 'GTM-N6DQ47T'

export default function gtmPlugin(): Plugin {
  return {
    name: 'docusaurus-plugin-gtm',

    injectHtmlTags() {
      return {
        headTags: [
          {
            tagName: 'script',
            attributes: {},
            innerHTML: `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${GTM_ID}');`,
          },
        ],
        preBodyTags: [
          `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${GTM_ID}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`,
        ],
      }
    },
  }
}
