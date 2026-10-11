import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const valueImports = (source: ts.SourceFile): string[] => {
  const imports: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
      const typesOnly =
        clause?.isTypeOnly ||
        (!clause?.name &&
          names &&
          ts.isNamedImports(names) &&
          names.elements.length > 0 &&
          names.elements.every((item) => item.isTypeOnly));
      if (!typesOnly && ts.isStringLiteral(node.moduleSpecifier))
        imports.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const typesOnly =
        node.isTypeOnly ||
        (node.exportClause &&
          ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.length > 0 &&
          node.exportClause.elements.every((item) => item.isTypeOnly));
      if (!typesOnly && ts.isStringLiteral(node.moduleSpecifier))
        imports.push(node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      !node.isTypeOnly &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      const expression = node.moduleReference.expression;
      if (expression && ts.isStringLiteral(expression)) imports.push(expression.text);
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const argument = node.arguments[0];
      imports.push(
        argument && ts.isStringLiteral(argument) ? argument.text : '<non-literal runtime import>',
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return imports;
};

/** Follow actual source imports, without aliases, externals or an installed bundler. */
export const inspectRuntimeClosure = (entry: string) => {
  const files = new Set<string>();
  const forbidden: string[] = [];
  const visit = (file: string): void => {
    file = path.resolve(file);
    if (files.has(file)) return;
    files.add(file);
    // Match TypeScript's emitted imports: legacy files also use ordinary import syntax for types.
    // Compiling removes those erased annotations; every emitted require/import is still followed.
    const emitted = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      fileName: file,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const source = ts.createSourceFile(file, emitted, ts.ScriptTarget.Latest, true);
    for (const specifier of valueImports(source)) {
      if (!specifier.startsWith('.')) {
        forbidden.push(`${path.basename(file)} -> ${specifier}`);
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      const resolved = [base, `${base}.ts`, `${base}.js`, path.join(base, 'index.ts')].find(
        (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
      );
      if (!resolved) forbidden.push(`${path.basename(file)} -> unresolved ${specifier}`);
      else visit(resolved);
    }
  };
  visit(entry);
  return { files: [...files].sort(), forbidden: forbidden.sort() };
};
