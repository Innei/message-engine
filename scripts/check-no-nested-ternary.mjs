import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import ts from 'typescript';

const sourceRoots = ['demo', 'src', 'test'];
const sourceExtensions = new Set(['.ts', '.tsx']);

const collectSourceFiles = (directory) => {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(entryPath));
      continue;
    }
    if (sourceExtensions.has(extname(entry.name))) files.push(entryPath);
  }

  return files;
};

const containsConditionalExpression = (node) => {
  if (ts.isConditionalExpression(node)) return true;

  let found = false;

  const visit = (child) => {
    if (found) return;
    if (ts.isConditionalExpression(child)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };

  ts.forEachChild(node, visit);
  return found;
};

const violations = [];

for (const file of sourceRoots.flatMap(collectSourceFiles)) {
  const sourceText = readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true);

  const visit = (node) => {
    if (
      ts.isConditionalExpression(node) &&
      (containsConditionalExpression(node.condition) ||
        containsConditionalExpression(node.whenTrue) ||
        containsConditionalExpression(node.whenFalse))
    ) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      violations.push(
        `${relative(process.cwd(), file)}:${position.line + 1}:${position.character + 1}`,
      );
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
}

if (violations.length > 0) {
  console.error('Nested ternary expressions are not allowed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
}
