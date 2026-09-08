import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';

test('serverless dependency graph uses resolvable Node ESM import extensions', () => {
  const visited = new Set<string>();
  function visit(file: string) {
    if (visited.has(file)) return;
    visited.add(file);
    const source = ts.preProcessFile(readFileSync(file, 'utf8'), true, true);
    for (const item of source.importedFiles) {
      const specifier = item.fileName;
      if (!specifier.startsWith('.')) continue;
      assert.match(specifier, /\.(?:js|mjs|cjs|json)$/, `${file}: ${specifier} breaks native Node ESM`);
      const resolved = path.resolve(path.dirname(file), specifier);
      const sourceFile = [resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx'), resolved]
        .find(candidate => existsSync(candidate));
      assert.ok(sourceFile, `${file}: unresolved import ${specifier}`);
      if (/\.[cm]?tsx?$/.test(sourceFile)) visit(sourceFile);
    }
  }
  visit(path.resolve('api/index.ts'));
});
