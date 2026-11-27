// @daml/types calls console.debug("Registered template <id>.") for every
// generated template at import time (see registerTemplate in @daml/types).
// In Node.js console.debug always prints (unlike browsers, which hide it
// behind the "Verbose" filter), so importing the Canton bindings floods the
// console. There is no opt-out upstream, so filter exactly that message.
const REGISTERED_TEMPLATE_PREFIX = 'Registered template '

const QUIET_GUARD = Symbol.for('@chainlink/ccip-sdk.damlQuietTemplateRegistration')
const originalDebug = console.debug

if (!(QUIET_GUARD in globalThis)) {
  Object.defineProperty(globalThis, QUIET_GUARD, { value: true })
  console.debug = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith(REGISTERED_TEMPLATE_PREFIX)) return
    originalDebug(...args)
  }
}
