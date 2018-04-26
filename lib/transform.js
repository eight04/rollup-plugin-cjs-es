const {traverse} = require("estraverse");
const MagicString = require("magic-string");
const ecmaVariableScope = require("ecma-variable-scope");

function getRequireInfo(node) {
  if (
    node.callee.name === "require" &&
    node.arguments.length === 1 &&
    node.arguments[0].type === "Literal"
  ) {
    return node.arguments[0];
  }
}

function doTransform({node, s, code, shouldSplitCode}) {
  const required = getRequireInfo(node);
  if (!required || node.callee.scopeInfo.type !== "undeclared") {
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

function wrapImport({parse, code, sourceMap = false, shouldSplitCode} = {}) {
  const s = new MagicString(code);
  const ast = parse(code);
  let isTouched = false;
  ecmaVariableScope(ast);
  traverse(ast, {enter(node) {
    if (node.type === "CallExpression") {
      isTouched = doTransform({node, s, code, shouldSplitCode}) || isTouched;
    }
  }});
  return {
    code: isTouched ? s.toString() : code,
    map: sourceMap && s.generateMap(),
    isTouched
  };
}

module.exports = {wrapImport};
