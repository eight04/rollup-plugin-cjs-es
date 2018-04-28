const {walk} = require("estree-walker");
const MagicString = require("magic-string");
const {attachScopes} = require("rollup-pluginutils");

function createScopeAnalyzer(ast) {
  let scope = attachScopes(ast, "scope");
  return {enter, leave, has};
  
  function enter(node) {
    if (node.scope) {
      scope = node.scope;
    }
  }
  function leave(node) {
    if (node.scope) {
      scope = node.scope.parent;
    }
  }
  function has(name) {
    return scope.contains(name);
  }
}

function getRequireInfo(node) {
  if (
    node.callee.name === "require" &&
    node.arguments.length === 1 &&
    node.arguments[0].type === "Literal"
  ) {
    return node.arguments[0];
  }
}

function transformWrapImport({node, s, code, shouldSplitCode, scope}) {
  const required = getRequireInfo(node);
  if (!required || scope.has("require")) {
    return false;
  }
  const rx = /.*?\/\/.*?split/y;
  rx.lastIndex = node.end;
  if (!rx.test(code) && !shouldSplitCode(required.value)) {
    return false;
  }
  s.overwrite(node.start, node.callee.end, "_UNWRAP_IMPORT_(import");
  s.appendLeft(node.end, ")");
  return true;
}

function wrapImport({
  parse,
  code,
  ast,
  sourceMap = false,
  shouldSplitCode
} = {}) {
  if (!ast) {
    ast = parse(code);
  }
  const s = new MagicString(code);
  let isTouched = false;
  const scope = createScopeAnalyzer(ast);
  let currentNode;
  function doWalk() {
    walk(ast, {enter(node) {
      currentNode = node;
      if (node.type === "CallExpression") {
        isTouched = transformWrapImport({node, s, code, shouldSplitCode, scope}) || isTouched;
      }
    }});
  }
  try {
    doWalk();
  } catch (err) {
    if (!err.node) {
      err.node = currentNode;
    }
    throw err;
  }
  return {
    code: isTouched ? s.toString() : code,
    map: isTouched && sourceMap && s.generateMap(),
    isTouched
  };
}

function transformUnwrapImport({node, s}) {
  if (node.callee.name !== "_UNWRAP_IMPORT_" || node.arguments[0].type !== "CallExpression") {
    return false;
  }
  const promise = node.arguments[0].callee;
  if (
    promise.type !== "MemberExpression" ||
    promise.object.name !== "Promise" ||
    promise.property.name != "resolve"
  ) {
    return false;
  }
  const require = node.arguments[0].arguments[0];
  if (!getRequireInfo(require)) {
    return false;
  }
  s.remove(node.callee.start, require.start);
  s.remove(require.end, node.end);
  return true;
}

function unwrapImport({parse, code, sourceMap = false} = {}) {
  const s = new MagicString(code);
  const ast = parse(code);
  let isTouched = false;
  walk(ast, {enter(node) {
    if (node.type === "CallExpression") {
      isTouched = transformUnwrapImport({node, s}) || isTouched;
    }
  }});
  return {
    code: isTouched ? s.toString() : code,
    map: isTouched && sourceMap && s.generateMap(),
    isTouched
  };
}

module.exports = {wrapImport, unwrapImport};
