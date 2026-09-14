const isIdentifier = (node, name) => node?.type === 'Identifier' && node.name === name

const isNewExpression = (node, name) =>
  node?.type === 'NewExpression' && isIdentifier(node.callee, name)

const isImportSpecifier = (node) => node?.type === 'ImportSpecifier'

const isExportSpecifier = (node) => node?.type === 'ExportSpecifier'

// A specifier is a type when written inline (`import { type X }` / `export { type X }`)
// or when the whole declaration is type-only (`import type { X }` / `export type { X }`).
const isTypeSpecifier = (specifier, declaration) =>
  specifier.importKind === 'type' ||
  specifier.exportKind === 'type' ||
  declaration?.importKind === 'type' ||
  declaration?.exportKind === 'type'

// Sort key is the name in the source module (what is written first): `imported`
// for imports, `local` for re-exports. Matches the repo's established order.
const specifierName = (specifier, sourceCode) =>
  specifier.type === 'ExportSpecifier'
    ? sourceCode.getText(specifier.local)
    : sourceCode.getText(specifier.imported ?? specifier.local)

const compareSpecifiers = (a, b, declaration, sourceCode) => {
  const typeOrder =
    Number(isTypeSpecifier(a, declaration)) - Number(isTypeSpecifier(b, declaration))
  if (typeOrder !== 0) return -typeOrder

  const aName = specifierName(a, sourceCode)
  const bName = specifierName(b, sourceCode)

  // Match the repo's established order: plain code-unit (ASCII) comparison of
  // the name, e.g. SVMExtraArgsV1 before SuiExtraArgsV1. localeCompare sorts
  // Sui before SVM, which would churn every mixed-case specifier.
  return aName < bName ? -1 : aName > bName ? 1 : 0
}

const reportUnorderedSpecifiers = (context, declaration, specifiers) => {
  if (specifiers.length < 2) return

  const sourceCode = context.sourceCode
  const orderedSpecifiers = [...specifiers].sort((a, b) =>
    compareSpecifiers(a, b, declaration, sourceCode),
  )
  const firstDifference = specifiers.find(
    (specifier, index) => specifier !== orderedSpecifiers[index],
  )

  if (!firstDifference) return

  context.report({
    node: firstDifference,
    message: 'Sort named import/export specifiers with type specifiers first.',
    fix(fixer) {
      return orderedSpecifiers.map((specifier, index) =>
        fixer.replaceTextRange(specifiers[index].range, sourceCode.getText(specifier)),
      )
    },
  })
}

// sort named imports and exports until https://github.com/oxc-project/oxc/issues/13610
const sortNamedSpecifiers = {
  meta: {
    name: 'sort-named-specifiers',
    fixable: 'code',
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        reportUnorderedSpecifiers(context, node, node.specifiers.filter(isImportSpecifier))
      },
      // Re-exports only (`export { ... } from '...'`); local `export { a, b }` is not touched.
      ExportNamedDeclaration(node) {
        if (!node.source) return
        reportUnorderedSpecifiers(context, node, node.specifiers.filter(isExportSpecifier))
      },
    }
  },
}

const restrictedSyntax = {
  meta: {
    name: 'ccip',
  },
  create(context) {
    const report = (node, message) => context.report({ node, message })

    return {
      NewExpression(node) {
        if (isIdentifier(node.callee, 'Error')) {
          report(
            node,
            'Use CCIPError or specialized error classes instead of generic Error. See src/errors/specialized.ts for available error types.',
          )
        }
      },
      CallExpression(node) {
        if (isIdentifier(node.callee, 'Error')) {
          report(
            node,
            'Use CCIPError or specialized error classes instead of generic Error. Use "new" with error classes.',
          )
        }
      },
      BinaryExpression(node) {
        if (
          node.operator === '**' &&
          ((node.left.type === 'Literal' && node.left.bigint) ||
            (node.right.type === 'Literal' && node.right.bigint))
        ) {
          report(
            node,
            'Do not use the ** operator with bigint literals. Use BigInt() for operands instead, e.g. BigInt(2) ** BigInt(64).',
          )
        }
      },
      VariableDeclaration(node) {
        for (const declaration of node.declarations) {
          if (node.kind !== 'using' && isNewExpression(declaration.init, 'DisposableStack')) {
            report(
              declaration.init,
              'Use `using stack = new DisposableStack()` — only `using` guarantees synchronous disposal at end of scope.',
            )
          }
          if (
            node.kind !== 'await using' &&
            isNewExpression(declaration.init, 'AsyncDisposableStack')
          ) {
            report(
              declaration.init,
              'Use `await using stack = new AsyncDisposableStack()` — only `await using` guarantees asynchronous disposal at end of scope.',
            )
          }
        }
      },
      ExpressionStatement(node) {
        if (isNewExpression(node.expression, 'DisposableStack')) {
          report(
            node.expression,
            'Assign `new DisposableStack()` with `using` so it is automatically disposed at end of scope.',
          )
        }
        if (isNewExpression(node.expression, 'AsyncDisposableStack')) {
          report(
            node.expression,
            'Assign `new AsyncDisposableStack()` with `await using` so it is automatically disposed at end of scope.',
          )
        }
      },
    }
  },
}

export default {
  meta: {
    name: 'ccip',
  },
  rules: {
    'restricted-syntax': restrictedSyntax,
    'sort-named-specifiers': sortNamedSpecifiers,
  },
}
