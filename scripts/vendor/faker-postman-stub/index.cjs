/**
 * A no-op stand-in for `@faker-js/faker`, installed only under
 * `postman-collection` (see the `overrides` block in the root package.json).
 *
 * Why it exists: `postman-collection` is the docs toolchain's OpenAPI→Postman
 * converter (`docusaurus-plugin-openapi-docs` → `openapi-to-postmanv2` →
 * `postman-collection`), and it is the last release of its line — it pins
 * `@faker-js/faker@5.5.3` exactly and, at import time, reads the pre-v8 API off
 * it (`faker.address.city`, `faker.random.arrayElement`, …) to build the
 * generators behind Postman's `{{$randomCity}}`-style dynamic variables.
 *
 * `5.5.3` is inside GHSA-qxc2-j82w-r537 (`<=10.4.0`), and every version that
 * patches it (>= 10.5) dropped those namespaces, so the two cannot coexist in a
 * tree in which postman-collection is importable. Since the docs pipeline only
 * runs OpenAPI → Postman → static pages — it never evaluates a dynamic variable
 * — this module takes faker's place there: every property access yields the same
 * no-op callable, which is exactly the shape postman-collection reads
 * (`generator: faker.address.city`). Anything that did call one gets `undefined`
 * instead of a random value, which is the behavior Postman's own docs describe
 * for an unresolvable variable.
 */
const stub = new Proxy(function faker() {}, {
  get: () => stub,
  apply: () => undefined,
})

module.exports = stub
