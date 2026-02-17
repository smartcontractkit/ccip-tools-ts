import Mermaid from '@theme/Mermaid'
import React from 'react'

import styles from './Architecture.module.css'

const architectureDiagram = `
flowchart TD
    subgraph NPM["<b>CCIP TypeScript Packages</b>"]
        SDK["<b>@chainlink/ccip-sdk</b><br/><i>Multi-chain SDK<br/>(EVM, Solana, Aptos, Sui, TON)</i>"]
        CLI["<b>@chainlink/ccip-cli</b><br/><i>Command-line tool</i>"]
        MCP["<b>MCP Server</b><br/><i>Tools, Resources, Prompts</i>"]
    end

    subgraph INFRA["<b>CCIP Infrastructure</b>"]
        CONTRACTS["<b>Onchain Contracts/Programs</b><br/><i>Read: Lane configs, pool configs, fee quotes, message events<br/>Write: ccipSend, execute (manual)</i>"]
        API["<b>CCIP API</b><br/><i>Message queries, lane latency</i>"]
    end

    subgraph EXTERNAL_API["<b>External Attestation APIs</b>"]
        CIRCLE["<b>Circle API</b><br/><i>USDC/CCTP attestations</i>"]
        LOMBARD["<b>Lombard API</b><br/><i>LBTC attestations</i>"]
    end

    subgraph APPS["<b>Applications & Integrations</b>"]
        INTERNAL["<b>Internal dApps</b>"]
        DAPPS["<b>External Cross-chain dApps</b>"]
        OPS["<b>Ops</b><br/><i>Message debugging, sending messages,<br/>manual execution</i>"]
    end

    subgraph AI["<b>AI Applications & Agents</b>"]
        CLAUDE_APPS["<b>Claude Apps</b><br/><i>Claude Desktop, Claude Code</i>"]
        IDE["<b>AI-Powered IDEs</b><br/><i>Cursor, VS Code</i>"]
        AGENTS["<b>Agent Frameworks</b><br/><i>OpenAI Agents SDK, LangChain,<br/>CrewAI, AutoGPT</i>"]
    end

    %% CLI and MCP depend on SDK
    CLI -->|"uses"| SDK
    MCP -->|"uses"| SDK

    %% SDK interacts with infrastructure
    SDK -->|"read/write<br/>transactions"| CONTRACTS
    SDK -->|"read<br/>status, latency"| API
    SDK -->|"read<br/>attestations"| CIRCLE
    SDK -->|"read<br/>attestations"| LOMBARD

    %% Applications use packages
    INTERNAL -->|"npm install"| SDK
    DAPPS -->|"npm install"| SDK
    OPS -->|"npm install"| SDK
    OPS -->|"npx / npm global install"| CLI

    %% AI Applications use MCP Server
    CLAUDE_APPS -->|"MCP protocol"| MCP
    IDE -->|"MCP protocol"| MCP
    AGENTS -->|"MCP protocol"| MCP

    %% Styling
    classDef npmStyle fill:#E3ECFF,stroke:#0847F7,stroke-width:2px,color:#0B101C
    classDef sdkStyle fill:#8AA6F9,stroke:#0847F7,stroke-width:2px,color:#0B101C
    classDef cliStyle fill:#8AA6F9,stroke:#0847F7,stroke-width:2px,color:#0B101C
    classDef mcpStyle fill:#C5B4E3,stroke:#7C3AED,stroke-width:2px,color:#0B101C
    classDef infraStyle fill:#F8FAFF,stroke:#0847F7,stroke-width:2px,color:#0B101C
    classDef externalStyle fill:#FFF5E6,stroke:#E67E22,stroke-width:2px,color:#0B101C
    classDef appStyle fill:#F2EBE0,stroke:#217B71,stroke-width:2px,color:#0B101C
    classDef aiStyle fill:#DCFCE7,stroke:#16A34A,stroke-width:2px,color:#0B101C

    class NPM npmStyle
    class SDK,CLI sdkStyle
    class MCP mcpStyle
    class INFRA,CONTRACTS,API infraStyle
    class EXTERNAL_API,CIRCLE,LOMBARD externalStyle
    class APPS,INTERNAL,DAPPS,OPS appStyle
    class AI,CLAUDE_APPS,IDE,AGENTS aiStyle
`

/** Architecture diagram showing CCIP Tools ecosystem */
export function Architecture(): React.JSX.Element {
  return (
    <section className={styles.architecture}>
      <div className={styles.container}>
        <h2 className={styles.title}>Architecture Overview</h2>
        <p className={styles.subtitle}>Dependencies between SDK, CLI, and CCIP API</p>
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} data-type="npm" />
            <span>NPM Packages</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} data-type="infra" />
            <span>CCIP Infrastructure</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} data-type="external" />
            <span>External APIs</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} data-type="apps" />
            <span>Applications</span>
          </div>
          <div className={styles.legendItem}>
            <span className={styles.legendColor} data-type="ai" />
            <span>AI Integrations</span>
          </div>
        </div>
        <div className={styles.diagramWrapper}>
          <Mermaid value={architectureDiagram} />
        </div>
      </div>
    </section>
  )
}
