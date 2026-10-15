#!/usr/bin/env node
/**
 * Fails when a function, class, method or constructor has no doc comment (see the "Doc comments" section of
 * docs/style_guide.md). It checks the files Biome covers, read from `files.includes` in biome.json, and only what is
 * declared at the top of a file or in a class there: a closure inside a function is read with the function around it.
 */
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";

// TypeScript's own parser, already a dependency for the type check. It is CommonJS, so it's loaded with require.
/** @type {typeof import("typescript")} */
const ts = createRequire(import.meta.url)("typescript");

/** @type {{ files: { includes: string[] } }} */
const biome = JSON.parse(readFileSync("biome.json", "utf8"));
const included = biome.files.includes.filter((pattern) => !pattern.startsWith("!"));
const excluded = biome.files.includes.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.slice(1));
const files = globSync(included, { exclude: excluded }).sort();

/**
 * The declarations that need a doc comment: the functions and classes at the top of the file, the functions assigned
 * to a variable there, and the methods, accessors, constructors and function properties of those classes.
 *
 * @param {import("typescript").SourceFile} source
 * @returns {Array<{ node: import("typescript").Node, name: string }>}
 */
function declarations(source) {
  /** @type {Array<{ node: import("typescript").Node, name: string }>} */
  const found = [];
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement)) {
      found.push({ node: statement, name: statement.name?.text ?? "default function" });
    } else if (ts.isClassDeclaration(statement)) {
      found.push({ node: statement, name: statement.name?.text ?? "default class" });
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) {
          found.push({ node: member, name: `${statement.name?.text}.constructor` });
        } else if (isFunctionMember(member)) {
          found.push({ node: member, name: `${statement.name?.text}.${member.name.getText(source)}` });
        }
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && isFunction(declaration.initializer)) {
          found.push({ node: statement, name: declaration.name.getText(source) });
        }
      }
    }
  }
  return found;
}

/**
 * Whether a class member is a method, an accessor, or a property holding a function.
 *
 * @param {import("typescript").ClassElement} member
 * @returns {member is import("typescript").ClassElement & { name: import("typescript").PropertyName }}
 */
function isFunctionMember(member) {
  return (
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member) ||
    (ts.isPropertyDeclaration(member) && member.initializer !== undefined && isFunction(member.initializer))
  );
}

/**
 * Whether an expression is an arrow function or a function expression.
 *
 * @param {import("typescript").Expression} expression
 * @returns {boolean}
 */
function isFunction(expression) {
  return ts.isArrowFunction(expression) || ts.isFunctionExpression(expression);
}

const missing = [];
for (const file of files) {
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const { node, name } of declarations(source)) {
    if (ts.getJSDocCommentsAndTags(node).length === 0) {
      const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
      missing.push(`${file}:${line + 1}: ${name} has no doc comment`);
    }
  }
}

if (missing.length > 0) {
  console.error(missing.join("\n"));
  console.error(`\ncheck-docs: ${missing.length} declarations without a doc comment`);
  process.exit(1);
}
console.log(`check-docs: OK (${files.length} files)`);
