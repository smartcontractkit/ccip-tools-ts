const isIdentifier = (node, name) => node?.type === 'Identifier' && node.name === name

const isNewExpression = (node, name) =>
  node?.type === 'NewExpression' && isIdentifier(node.callee, name)

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
  },
}
