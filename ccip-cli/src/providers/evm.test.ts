import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

import { Wallet } from 'ethers'

import { loadEvmWallet } from './evm.ts'

// A passwordless keystore is encrypted with the empty string. Foundry creates these routinely
// (`cast wallet import --unsafe-password ""`), and they are what `--no-interactive` must accept.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'
const TEST_ADDRESS = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'

const PASSWORD_VARS = [
  'FOUNDRY_KEYSTORE_PASSWORD',
  'HARDHAT_KEYSTORE_PASSWORD',
  'USER_KEY_PASSWORD',
] as const

let tmp: string
let foundryDir: string
let jsonWalletPath: string
const savedEnv = new Map<string, string | undefined>()
const savedCwd = process.cwd()

before(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ccip-cli-keystore-'))
  foundryDir = join(tmp, 'foundry')
  mkdirSync(join(foundryDir, 'keystores'), { recursive: true })

  // Encrypted with "" once and reused by every case: scrypt makes each encrypt/decrypt costly.
  const keystoreJson = new Wallet(TEST_KEY).encryptSync('')
  writeFileSync(join(foundryDir, 'keystores', 'passwordless'), keystoreJson)
  jsonWalletPath = join(tmp, 'wallet.json')
  writeFileSync(jsonWalletPath, keystoreJson)

  for (const key of [...PASSWORD_VARS, 'FOUNDRY_DIR']) savedEnv.set(key, process.env[key])
  process.env['FOUNDRY_DIR'] = foundryDir
})

after(() => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  process.chdir(savedCwd)
  rmSync(tmp, { recursive: true, force: true })
})

beforeEach(() => {
  for (const key of PASSWORD_VARS) delete process.env[key]
})

describe('Foundry keystore', () => {
  it('should unlock a passwordless keystore when the password is set to the empty string', async () => {
    // The bug: `!pw` treated "" as missing, so a passwordless keystore could not be used at all
    // with --no-interactive. "" is the keystore's real password, not an absent one.
    process.env['FOUNDRY_KEYSTORE_PASSWORD'] = ''
    const signer = await loadEvmWallet(null as never, {
      wallet: 'foundry:passwordless',
      interactive: false,
    })
    assert.equal(await signer.getAddress(), TEST_ADDRESS)
  })

  it('should still refuse when the password is genuinely unset', async () => {
    // The fix must not turn "missing" into "empty": an unset variable has nothing to unlock with.
    await assert.rejects(
      () => loadEvmWallet(null as never, { wallet: 'foundry:passwordless', interactive: false }),
      { name: 'CCIPInteractiveRequiredError' },
    )
  })

  it('should accept the empty password from USER_KEY_PASSWORD too', async () => {
    process.env['USER_KEY_PASSWORD'] = ''
    const signer = await loadEvmWallet(null as never, {
      wallet: 'foundry:passwordless',
      interactive: false,
    })
    assert.equal(await signer.getAddress(), TEST_ADDRESS)
  })
})

describe('JSON wallet file', () => {
  it('should unlock with an empty USER_KEY_PASSWORD under --no-interactive', async () => {
    process.env['USER_KEY_PASSWORD'] = ''
    const signer = await loadEvmWallet(null as never, {
      wallet: jsonWalletPath,
      interactive: false,
    })
    assert.equal(await signer.getAddress(), TEST_ADDRESS)
  })

  it('should still refuse when USER_KEY_PASSWORD is unset', async () => {
    await assert.rejects(
      () => loadEvmWallet(null as never, { wallet: jsonWalletPath, interactive: false }),
      { name: 'CCIPInteractiveRequiredError' },
    )
  })
})

describe('Hardhat keystore', () => {
  // Hardhat decrypts the keystore itself; ccip-cli only forwards the password to it. These cover
  // the forwarding contract, not whether Hardhat accepts a given password (it rejects passwords
  // shorter than 8 characters at creation time, so a passwordless Hardhat keystore cannot exist).
  let projectDir: string

  before(() => {
    projectDir = join(tmp, 'hardhat-project')
    mkdirSync(join(projectDir, 'node_modules', '.bin'), { recursive: true })
    const fakeBin = join(projectDir, 'node_modules', '.bin', 'hardhat')
    // Records what was piped in, then returns the key so the success path can be asserted.
    writeFileSync(
      fakeBin,
      `#!/bin/sh\ncat > "${join(projectDir, 'stdin.txt')}"\necho "${TEST_KEY}"\n`,
    )
    chmodSync(fakeBin, 0o755)
  })

  it('should forward an empty password instead of rejecting it as missing', async () => {
    process.chdir(projectDir)
    process.env['HARDHAT_KEYSTORE_PASSWORD'] = ''
    const signer = await loadEvmWallet(null as never, {
      wallet: 'hardhat:acct',
      interactive: false,
    })
    assert.equal(await signer.getAddress(), TEST_ADDRESS)
  })

  it('should still refuse when the password is genuinely unset', async () => {
    process.chdir(projectDir)
    await assert.rejects(
      () => loadEvmWallet(null as never, { wallet: 'hardhat:acct', interactive: false }),
      { name: 'CCIPInteractiveRequiredError' },
    )
  })
})
