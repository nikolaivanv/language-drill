/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  extends: ['./.eslintrc.base.js'],
  ignorePatterns: ['dist/', 'node_modules/', '.next/', 'cdk.out/'],
};
