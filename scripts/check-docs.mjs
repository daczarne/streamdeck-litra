#!/usr/bin/env node
/**
 * Checks the doc comments the style guide asks for, in its "Doc comments" section:
 * - every function, class, method and constructor declared at the top of a file, in a class there, or in a function
 *   that wraps the file and runs at once, has one
 * - in JavaScript, it gives every parameter a `@param` and every function a `@returns`, each with its type, unless a
 *   `@type` types the whole function
 * - in TypeScript, its `@param` and `@returns` give no type, which the signature holds
 *
 * It reads the files Biome checks, from `files.includes` in biome.json, keeping the TypeScript and the JavaScript, and
 * parses them with the repo's TypeScript, which attaches a doc comment to a declaration as the editor shows it: one
 * between a class's decorator and the class isn't attached, and is reported.
 */
import { globSync, readFileSync } from "node:fs";
import ts from "typescript";

/**
 * @typedef {object} Declaration
 * @property {ts.Node} node the node the doc comment attaches to
 * @property {string} kind what the declaration is, as the report names it
 * @property {string} name its name, as the report names it, a member's after its class's
 * @property {ts.SignatureDeclaration} [signature] the function it declares, whose parameters and result are documented
 */

/**
 * The files the rule covers: the TypeScript and JavaScript files Biome checks, as `files.includes` in biome.json lists
 * them, without the ones it excludes, with `!` or `!!`.
 *
 * @returns {string[]}
 */
function filesChecked() {
  /** @type {{ files: { includes: string[] } }} */
  const biome = JSON.parse(readFileSync("biome.json", "utf8"));
  const patterns = biome.files.includes;
  const included = patterns.filter((pattern) => !pattern.startsWith("!"));
  const excluded = patterns.filter((pattern) => pattern.startsWith("!")).map((pattern) => pattern.replace(/^!!?/, ""));
  return globSync(included, { exclude: excluded })
    .filter((path) => /\.(ts|mjs|js)$/.test(path))
    .sort();
}

/**
 * A declaration's name, as written in the file, or a stand-in for one that has none, such as `export default class`.
 *
 * @param {ts.Node | undefined} name the declaration's name node
 * @param {ts.SourceFile} file the file it's in
 * @returns {string}
 */
function nameOf(name, file) {
  return name === undefined ? "(anonymous)" : name.getText(file);
}

/**
 * The expression inside parentheses, `as` and `satisfies`, which change its type but not what it is.
 *
 * @param {ts.Expression} expression the expression
 * @returns {ts.Expression}
 */
function unwrapped(expression) {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner) || ts.isAsExpression(inner) || ts.isSatisfiesExpression(inner)) {
    inner = inner.expression;
  }
  return inner;
}

/**
 * The function an expression holds, such as what a variable or a class property is set to where it's declared.
 *
 * @param {ts.Expression | undefined} expression the expression
 * @returns {ts.ArrowFunction | ts.FunctionExpression | undefined}
 */
function functionIn(expression) {
  if (expression === undefined) {
    return undefined;
  }
  const inner = unwrapped(expression);
  return ts.isArrowFunction(inner) || ts.isFunctionExpression(inner) ? inner : undefined;
}

/**
 * The statements of a function that wraps a file and runs at once, such as `(() => { … })();`, which hold what the file
 * declares, or undefined when the statement isn't one.
 *
 * @param {ts.Statement} statement a statement at the top of the file
 * @returns {ts.NodeArray<ts.Statement> | undefined}
 */
function wrappedStatements(statement) {
  if (!ts.isExpressionStatement(statement)) {
    return undefined;
  }
  let call = statement.expression;
  while (ts.isVoidExpression(call) || ts.isAwaitExpression(call)) {
    call = call.expression;
  }
  if (!ts.isCallExpression(call)) {
    return undefined;
  }
  const fn = functionIn(call.expression);
  return fn !== undefined && ts.isBlock(fn.body) ? fn.body.statements : undefined;
}

/**
 * The members of a class the rule covers: its constructor, methods and accessors, and the properties set to a
 * function, which are methods written as fields.
 *
 * @param {ts.ClassLikeDeclaration} cls the class
 * @param {string} className the class's name, as the report names it
 * @param {ts.SourceFile} file the file it's in
 * @returns {Declaration[]}
 */
function membersOf(cls, className, file) {
  /** @type {Declaration[]} */
  const members = [];
  for (const member of cls.members) {
    if (ts.isConstructorDeclaration(member)) {
      members.push({ node: member, kind: "constructor", name: className, signature: member });
    } else if (ts.isMethodDeclaration(member) || ts.isGetAccessor(member) || ts.isSetAccessor(member)) {
      const kind = ts.isGetAccessor(member) ? "getter" : ts.isSetAccessor(member) ? "setter" : "method";
      members.push({ node: member, kind, name: `${className}.${nameOf(member.name, file)}`, signature: member });
    } else if (ts.isPropertyDeclaration(member)) {
      const fn = functionIn(member.initializer);
      if (fn !== undefined) {
        members.push({
          node: member,
          kind: "method",
          name: `${className}.${nameOf(member.name, file)}`,
          signature: fn,
        });
      }
    }
  }
  return members;
}

/**
 * The declarations among some statements that the rule covers, and in their classes, and in a function that wraps
 * them and runs at once.
 *
 * @param {readonly ts.Statement[]} statements the statements at the top of a file, or of a function that wraps it
 * @param {ts.SourceFile} file the file they're in
 * @returns {Declaration[]}
 */
function declarationsIn(statements, file) {
  /** @type {Declaration[]} */
  const declarations = [];
  for (const statement of statements) {
    const wrapped = wrappedStatements(statement);
    if (wrapped !== undefined) {
      declarations.push(...declarationsIn(wrapped, file));
    } else if (ts.isFunctionDeclaration(statement)) {
      declarations.push({
        node: statement,
        kind: "function",
        name: nameOf(statement.name, file),
        signature: statement,
      });
    } else if (ts.isClassDeclaration(statement)) {
      const name = nameOf(statement.name, file);
      declarations.push({ node: statement, kind: "class", name }, ...membersOf(statement, name, file));
    } else if (ts.isExportAssignment(statement)) {
      const fn = functionIn(statement.expression);
      if (fn !== undefined) {
        declarations.push({ node: statement, kind: "function", name: "(default)", signature: fn });
      }
    } else if (ts.isVariableStatement(statement)) {
      for (const variable of statement.declarationList.declarations) {
        const name = nameOf(variable.name, file);
        const fn = functionIn(variable.initializer);
        const value = variable.initializer === undefined ? undefined : unwrapped(variable.initializer);
        if (fn !== undefined) {
          declarations.push({ node: variable, kind: "function", name, signature: fn });
        } else if (value !== undefined && ts.isClassExpression(value)) {
          declarations.push({ node: variable, kind: "class", name }, ...membersOf(value, name, file));
        }
      }
    }
  }
  return declarations;
}

/**
 * The doc comment attached to a declaration, the last one when there are several, or undefined when there's none.
 *
 * @param {ts.Node} node the declaration
 * @returns {ts.JSDoc | undefined}
 */
function docOf(node) {
  return ts.getJSDocCommentsAndTags(node).filter(ts.isJSDoc).at(-1);
}

/**
 * The `@param` a doc comment gives a parameter: the one of its name, or, for a parameter destructured, the one in its
 * place among the doc comment's `@param`s, leaving out the ones for its properties, such as `options.name`.
 *
 * @param {ts.ParameterDeclaration} parameter the parameter
 * @param {number} index its place among its function's parameters
 * @param {ts.JSDocParameterTag[]} tags the doc comment's `@param`s
 * @returns {ts.JSDocParameterTag | undefined}
 */
function paramTagOf(parameter, index, tags) {
  const own = tags.filter((tag) => ts.isIdentifier(tag.name));
  if (ts.isIdentifier(parameter.name)) {
    const name = parameter.name.text;
    return own.find((tag) => ts.isIdentifier(tag.name) && tag.name.text === name);
  }
  return own[index];
}

/**
 * What a JavaScript doc comment misses of its function: a typed `@param` for each parameter, and a typed `@returns`,
 * which a constructor and a setter don't have.
 *
 * A doc comment that types the whole function with `@type`, such as `@type {Badge}`, types its parameters and result
 * that way, and needs neither.
 *
 * @param {ts.JSDoc} doc the doc comment
 * @param {ts.SignatureDeclaration} signature the function it documents
 * @returns {string[]}
 */
function missingTags(doc, signature) {
  /** @type {readonly ts.JSDocTag[]} */
  const tags = doc.tags ?? [];
  if (tags.some(ts.isJSDocTypeTag)) {
    return [];
  }
  const paramTags = tags.filter(ts.isJSDocParameterTag);
  const missing = [];
  signature.parameters.forEach((parameter, index) => {
    const tag = paramTagOf(parameter, index, paramTags);
    const name = ts.isIdentifier(parameter.name) ? parameter.name.text : `parameter ${index + 1}`;
    if (tag === undefined) {
      missing.push(`a @param for ${name}`);
    } else if (tag.typeExpression === undefined) {
      missing.push(`a type in the @param for ${name}`);
    }
  });
  if (!ts.isConstructorDeclaration(signature) && !ts.isSetAccessor(signature)) {
    const tag = tags.find(ts.isJSDocReturnTag);
    if (tag === undefined) {
      missing.push("a @returns");
    } else if (tag.typeExpression === undefined) {
      missing.push("a type in its @returns");
    }
  }
  return missing;
}

/**
 * The types a TypeScript doc comment gives in its `@param`s and `@returns`, which its signature holds instead.
 *
 * @param {ts.JSDoc} doc the doc comment
 * @param {ts.SourceFile} file the file it's in
 * @returns {string[]}
 */
function typedTags(doc, file) {
  const typed = [];
  for (const tag of doc.tags ?? []) {
    if (ts.isJSDocParameterTag(tag) && tag.typeExpression !== undefined) {
      typed.push(`its @param for ${tag.name.getText(file)}`);
    } else if (ts.isJSDocReturnTag(tag) && tag.typeExpression !== undefined) {
      typed.push("its @returns");
    }
  }
  return typed;
}

/**
 * What a file's doc comments miss of the rule, one line each.
 *
 * @param {string} path the file, relative to the repo
 * @returns {string[]}
 */
function problemsIn(path) {
  const javascript = /\.m?js$/.test(path);
  const kind = javascript ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const file = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const problems = [];
  for (const { node, kind: what, name, signature } of declarationsIn(file.statements, file)) {
    const at = `${path}:${file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1}: ${what} ${name}`;
    const doc = docOf(node);
    if (doc === undefined) {
      problems.push(`${at} has no doc comment`);
    } else if (javascript) {
      const missing = signature === undefined ? [] : missingTags(doc, signature);
      if (missing.length > 0) {
        problems.push(`${at}: its doc comment lacks ${missing.join(", ")}`);
      }
    } else {
      const typed = typedTags(doc, file);
      if (typed.length > 0) {
        problems.push(`${at}: its doc comment gives a type in ${typed.join(", ")}, which the signature holds`);
      }
    }
  }
  return problems;
}

const files = filesChecked();
const problems = files.flatMap(problemsIn);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  console.error(`\ncheck-docs: ${problems.length} problems with doc comments`);
  process.exit(1);
}
console.log(`check-docs: OK (${files.length} files)`);
