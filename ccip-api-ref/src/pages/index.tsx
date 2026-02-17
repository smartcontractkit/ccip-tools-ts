import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'
import React from 'react'

import {
  Architecture,
  ChainSupportSection,
  ExamplesShowcase,
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
        <ExamplesShowcase />
        <ChainSupportSection />
        <Architecture />
        <Resources />
      </main>
    </Layout>
  )
}
