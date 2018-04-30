const MagicString = require("magic-string");
const {walk} = require("estree-walker");

function createTransformer(options) {
  const context = Object.assign({}, options);
  context.s = new MagicString(context.code);
  if (!context.ast) {
    context.ast = options.parse(context.code);
  }
  context.isTouched = false;
  return {transform};
  
  function transform() {
    walk(context.ast, {
      enter(node) {
        if (node.type === "CallExpression") {
          unwrapImport(node);
        }
      }
    });
    if (context.isTouched) {
      return {
        code: context.s.toString(),
        map: sourceMap && context.s.generateMap(),
        isTouched: true
      };
    }
    return {
      code,
      isTouched: false
    };
  }
  
  function unwrapImport(node) {
    if (node.callee.name !== "_UNWRAP_IMPORT_" || node.arguments[0].type !== "CallExpression") {
      return;
    }
    const promise = node.arguments[0].callee;
    if (
      promise.type !== "MemberExpression" ||
      promise.object.name !== "Promise" ||
      promise.property.name != "resolve"
    ) {
      return;
    }
    const require = node.arguments[0].arguments[0];
    if (!getRequireInfo(require)) {
      return;
    }
    context.s.remove(node.callee.start, require.start);
    context.s.remove(require.end, node.end);
    context.isTouched = true;
  }
}

module.exports = {
  unwrapImport(options) {
    return createTransformer(options).transform()
  }
};
