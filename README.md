rollup-plugin-cjs-es
====================

[![Build Status](https://travis-ci.org/eight04/rollup-plugin-cjs-es.svg?branch=master)](https://travis-ci.org/eight04/rollup-plugin-cjs-es)

Convert CommonJS module into ES module. Powered by [cjs-es](https://github.com/eight04/cjs-es).

Installation
------------

```
npm install -D rollup-plugin-cjs-es
```

Usage
-----

```js
import cjsEs from "rollup-plugin-cjs-es"

export default {
  input: ["entry.js"],
  output: {
    dir: "dist",
    format: "cjs"
  },
  plugins: [
    cjsEs({
      include: ["*.js"],
      exclude: [],
      exportType: "default",
      sourceMap: true,
      splitCode: true,
      hoist: true,
      dynamicImport: true
    })
  ]
};
```

Compatibility
-------------

`cjs-es` can transform top-level `require`, `exports`, and `module.exports` statements. For those non-top-level statements, the transformer hoist them to top-level (optional, off by default):

```js
const baz = require("foo").bar.baz;
if (baz) {
  const bak = require("bar");
}
```

After hoisting:

```js
const _require_foo_ = require("foo");
const baz = _require_foo_.bar.baz;
const _require_bar_ = require("bar");
if (baz) {
  const bak = _require_bar_;
}
```

However, if `require`, `exports`, or `module` are dynamically assigned, the transformer can't find them e.g.

```js
(function(r) {
  r("foo");
})(require);
```

```js
const r = require;
r("foo");
```

These patterns are common in module loaders like UMD. I suggest using other plugin to unwrap the module back to normal CJS pattern.

Lazy load and code splitting
----------------------------

To lazy load an ES module, we can use `import()` function:

*foo.js*
```js
export const foo = () => {
  return import("./bar");
};
```

*bar.js*
```js
export const bar = "bar";
```

After rolluped into CommonJS format, the dist folder would contain two entries:

*foo.js*
```js
'use strict';

const foo = () => {
  return Promise.resolve(require("./bar.js"));
};

exports.foo = foo;
```

*bar.js*
```js
'use strict';

const bar = "bar";

exports.bar = bar;
```

So that `bar.js` is not loaded until `require("foo").foo()` is called.

With this plugin, you can use the same feature in CommonJS syntax, by writing the require statement inside a promise i.e. `Promise.resolve(require("..."))` (must set `options.dynamicImport` to `true`):

```js
module.exports = {
  foo: () => {
    return Promise.resolve(require("./bar.js"));
  }
};
```

Or, by adding a special comment `// split` if you can't use async function (must set `options.splitCode` to `true`):

```js
module.exports = {
  foo: () => {
    return require("./bar"); // split
  }
};
```

Note that in the later form, the result is a sync `require` function call, which means **the output format must be `cjs`**.

Named import/export v.s. default import/export
----------------------------------------------

### Cannot call a namespace

In the following example, you would get an error:

*entry.js*
```js
const foo = require("./foo");
foo();
```

*foo.js*
```js
module.exports = function() {
  console.log("foo");
};
```

```
entry.js → dist...
[!] Error: Cannot call a namespace ('foo')
entry.js (2:0)
1: const foo = require("./foo");
2: foo();
   ^
```

To fix it, [mark the require as `// default`](https://github.com/eight04/cjs-es#import-style), or use `exportType` option to tell the plugin that *foo.js* uses default export.

### Dynamic import() problem with default export

In the following example, you would get an error **under ES enviroment**:

*entry.js*
```js
Promise.resolve(require("./foo"))
  .then(foo => foo());
```

*foo.js*
```js
module.exports = function() {
  console.log("foo");
};
```

After rolluped into ES format and renamed them into `.mjs`:

*entry.mjs*
```js
import("./foo.mjs")
  .then(foo => foo());
```

*foo.mjs*
```js
function foo() {
  console.log("foo");
}

export default foo;
```

```
(node:9996) ExperimentalWarning: The ESM module loader is experimental.
(node:9996) UnhandledPromiseRejectionWarning: TypeError: foo is not a function
    at then.foo (file:///D:/Dev/node-test/dist/entry.mjs:2:16)
    at <anonymous>
```

To correctly call the default member, `entry.js` has to be modified:

```js
Promise.resolve(require("./foo"))
  .then(foo => foo.default());
```

However, this would break other enviroments like CommonJS:

```
(node:9432) UnhandledPromiseRejectionWarning: TypeError: foo.default is not a fu
nction
    at Promise.resolve.then.foo (D:\Dev\node-test\dist\entry.js:4:27)
    at <anonymous>
    at process._tickCallback (internal/process/next_tick.js:118:7)
    at Function.Module.runMain (module.js:705:11)
    at startup (bootstrap_node.js:193:16)
    at bootstrap_node.js:660:3
```

Avoid default export if you want to use dynamic `import()` + CommonJS in the same time.

### rollup-plugin-commonjs

The [commonjs](https://github.com/rollup/rollup-plugin-commonjs) plugin uses a smart method to determine whether to use named or default import. It creates a proxy loader when a module is imported:

*source*
```js
const foo = require("foo");
foo.bar();
```

*transformed*
```js
import "foo";
import foo from "commonjs-proxy:foo";
foo.bar();
```

With this method, it can first look into the `"foo"` module to check its export type, then generate the proxy module which maps named exports into a default export. However, if the required module `"foo"` uses named exports, it has to be converted into a single object:

*commonjs-proxy:foo*
```js
import * as _ from "foo";
export default _;
```

As a result, all named exports are included in the bundle even that only `bar` is used.

The same problem applies to cjs-es as well if you force a module to use default export:

*entry.js*
```js
const foo = require("./foo");
foo.foo();
```

*foo.js*
```js
module.exports = {
  foo: () => console.log("foo"),
  bar: () => console.log("bar")
};
```

*bundled*
```js
const _export_foo_ = () => console.log("foo");

_export_foo_();
```

*bundled with `exportType: "default"`*
```js
var foo = {
  foo: () => console.log("foo"),
  bar: () => console.log("bar")
};

foo.foo();
```

API reference
-------------

This module exports a single function.

### cjsEsFactory(options?: object): RollupPlugin object

`options` may have following optional properties:

* `include`: `Array<string>`. A list of minimatch pattern. Only matched files would be transformed. Match all files by default.
* `exclude`: `Array<string>`. A list of minimatch pattern. Override `options.include`. Default: `[]`.
* `sourceMap`: `boolean`. If true then generate the source map. Default: `true`.
* `splitCode`: `boolean|function`. If true then enable code-splitting for require statements which are marked as `// split`. See [Lazy load and code splitting](#lazy-load-and-code-splitting) for details.

  If `splitCode` is a function, it would receives 2 arguments:
  
  - `importer`: `string`. The module ID which is being transformed. It is usually an absolute path.
  - `importee`: `string`. The require ID inside `require()` function.
  
  The return value should be a `boolean`.
  
  Default: `false`
  
* `hoist`: `boolean`. If true then enable [hoist transformer](https://github.com/eight04/cjs-es#hoist). Default: `false`.
* `dynamicImport`: `boolean`. If true then enable [dynamic import transformer](https://github.com/eight04/cjs-es#dynamic-import). Default: `false`.
* `exportType`: `string|object|function`. Tell the plugin what type of the export does the module use.

  If `exportType` is a function, it receives 2 arguments:
  
  - `modulId`: `string`. The ID of the module.
  - `importer`: `null|string`. If the module is imported by an importer, this would be the ID of the importer module.
  
  The return value should be the type of export for `moduleId`.
  
  If `exportType` is an object, it is a `"path/to/module": type` map.
  
  Default: `"named"`.

Changelog
---------

* 0.1.0 (Apr 27, 2018)

  - Initial releast.
