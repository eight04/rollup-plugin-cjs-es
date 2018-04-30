const MagicString = require("magic-string");
const {walk} = require("estree-walker");
const {createScopeAnalyzer, getRequireInfo} = require("cjs-es/lib/util");

const RX_SPLIT = /.*?\/\/.*?split/y;

function createTransformer(options) {
  const context = Object.assign({}, options);
  if (!context.ast) {
    context.ast = options.parse(context.code);
  }
  context.s = new MagicString(context.code);
  context.scope = createScopeAnalyzer(context.ast);
  context.node = null;
  context.isTouched = false;
  context.hasSplitComment = node => {
    RX_SPLIT.lastIndex = node.end;
    return RX_SPLIT.test(context.code);
  };
  return {transform};
  
  function walkTree() {
    walk(context.ast, {
      enter(node) {
        context.node = node;
        context.scope.enter(node);
        if (node.type === "CallExpression") {
          wrapImport(node);
        }
      },
      leave(node) {
        context.scope.leave(node);
      }
    });
  }
  
  function wrapImport(node) {
    const required = getRequireInfo(node);
    if (
      !required || context.scope.has("require") ||
      !context.hasSplitComment(node) && !context.shouldSplitCode(required.value)
    ) {
      return;
    }
    context.s.overwrite(node.start, node.callee.end, "_UNWRAP_IMPORT_(import");
    context.s.appendLeft(node.end, ")");
    context.isTouched = true;
  }

  function transform() {
    try {
      walkTree();
    } catch (err) {
      if (err.pos == null && context.node) {
        err.pos = context.node.start;
      }
      throw err;
    }
    if (context.isTouched) {
      return {
        code: context.s.toString(),
        map: options.sourceMap && context.s.generateMap(),
        isTouched: true
      };
    }
    return {
      code: context.code,
      isTouched: false
    };
  }
}

module.exports = {
  wrapImport(options) {
    return createTransformer(options).transform();
  }
};
