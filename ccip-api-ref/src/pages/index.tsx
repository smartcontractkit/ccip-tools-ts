import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import React from 'react'

import {
  ChainSupportSection,
  Features,
  Hero,
  QuickStart,
  Resources,
} from '../components/homepage/index.ts'

/** CCIP Tools API Reference Homepage */
export default function Home(): React.JSX.Element {
  const { siteConfig } = useDocusaurusContext()

  return (
    <Layout title={siteConfig.title} description={siteConfig.tagline}>
      <main>
        <Hero />
        <Features />
        <QuickStart />
        <ChainSupportSection />
        <Resources />
      </main>
    </Layout>
  )
}
