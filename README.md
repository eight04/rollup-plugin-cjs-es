rollup-plugin-cjs-es
====================

[![Build Status](https://travis-ci.org/eight04/rollup-plugin-cjs-es.svg?branch=master)](https://travis-ci.org/eight04/rollup-plugin-cjs-es)
[![Coverage Status](https://coveralls.io/repos/github/eight04/rollup-plugin-cjs-es/badge.svg?branch=master)](https://coveralls.io/github/eight04/rollup-plugin-cjs-es?branch=master)
[![install size](https://packagephobia.now.sh/badge?p=rollup-plugin-cjs-es)](https://packagephobia.now.sh/result?p=rollup-plugin-cjs-es)

Convert CommonJS module into ES module. Powered by [cjs-es](https://github.com/eight04/cjs-es).

Installation
------------

```
npm install -D rollup-plugin-cjs-es
```

Features
--------

* Transform typical cases.
* Emit warnings for unconverted `require`s.
* Use a cache file to solve export type conflicts instead of using proxy modules.
* Split code with sync `require()` or async `Promise.resolve(require())`.

Usage
-----

```js
import cjs from "rollup-plugin-cjs-es";

export default {
  input: ["entry.js"],
  output: {
    dir: "dist",
    format: "cjs"
  },
  plugins: [
    cjs({
      nested: true
    })
  ]
};
```

Compatibility
-------------

`cjs-es` can transform top-level `require`, `exports`, and `module.exports` statements into `import` and `export`. For those non-top-level statements, the transformer hoist them to top-level:

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

However, if `require`, `exports`, or `module` are dynamically assigned, the transformer can't find them and it will emit a warning e.g.

```js
(function(r) {
  r("foo");
})(require);
```

```js
const r = require;
r("foo");
```

These patterns are common in module loaders like UMD. I suggest using other plugins to unwrap the module back to the normal CJS pattern.

Lazy load and code splitting
----------------------------

To lazy load an ES module, we can use the `import()` function:

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

With this plugin, you can use the same feature with CommonJS syntax, by writing the require statement inside a promise:

```js
module.exports = {
  foo: () => {
    return Promise.resolve(require("./bar.js"));
  }
};
```

Or, by adding a special comment `// split` if you have to load it synchronously (must set `options.splitCode` to `true`):

```js
module.exports = {
  foo: () => {
    return require("./bar"); // split
  }
};
```

Note that in the later form, the result is a sync `require` function call, which means that **the output format must be `cjs`**.

Named import/export v.s. default import/export
----------------------------------------------

### Missing exports: foo is not exported by foo.js

In the following example, you would get a warning:

*entry.js*
```js
const foo = require("./foo");
foo.foo();
```

*foo.js*
```js
const myObject = {
  foo: () => console.log("foo");
};
// assign the entire object so that cjs-es won't convert the object pattern into named exports.
module.exports = myObject;
```

```
(!) Missing exports
https://github.com/rollup/rollup/wiki/Troubleshooting#name-is-not-exported-by-mo
dule
entry.js
foo is not exported by foo.js
1: import * as foo from "./foo";
2: foo.foo();
       ^
```

That is because cjs-es tends to import named exports by default.

To solve this problem, the plugin generates a `.cjsescache` file when a build is finished (whether it succeeded or not), which record the export type of each imported module. In the next build, it will read the cache file and determine the export type according to the cache.

You can also use `exportType` option to tell the plugin that *foo.js* exports default member manually:

```js
{
  plugins: [
    cjsEs({
      exportType: {
        // the path would be resolved with the current directory.
        "foo.js": "default"
      }
    })
  ]
}
```

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

### Comparing to rollup-plugin-commonjs

[rollup-plugin-commonjs](https://github.com/rollup/rollup-plugin-commonjs) uses a smart method to determine whether to use named or default import. It creates a proxy loader when a module is imported:

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

With this technic, it can first look into the `"foo"` module to check its export type, then generate the proxy module which maps named exports into a default export. However, if the required module `"foo"` uses named exports, it has to be converted into a single object:

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

> Note that this won't be true after rollup supports tree-shaking for object literal. See https://github.com/rollup/rollup/issues/2201

API
----

This module exports a single function.

### cjsEsFactory
```js
cjsEsFactory(options?:Object) => rollupPlugin
```

`options` has following optional properties:

* `include`: `Array<string>`. A list of minimatch pattern. Only matched files would be transformed. Match all files by default.
* `exclude`: `Array<string>`. A list of minimatch pattern. Override `options.include`. Default: `[]`.
* `cache`: `Boolean`. If true then read/write the cache file. Default: `true`.
* `sourceMap`: `boolean`. If true then generate the source map. Default: `true`.
* `splitCode`: `boolean|function`. If true then enable code-splitting for require statements which are marked as `// split`. See [Lazy load and code splitting](#lazy-load-and-code-splitting) for details.

  If `splitCode` is a function, it would receives 2 arguments:
  
  - `importer`: `string`. The module ID which is being transformed. It is usually an absolute path.
  - `importee`: `string`. The require ID inside `require()` function.
  
  The return value should be a `boolean`.
  
  Default: `false`
  
* `nested`: `boolean`. If true then analyze the AST recursively, otherwise only top-level nodes are analyzed. Default: `false`.
* `exportType`: `null|string|object|function`. Tell the plugin how to determine the export type. Valid export types are `"named"`, `"default"`.

  If `exportType` is a function, it has following signature:
  
  ```js
  (moduleId) => exportType:String|null|Promise<String|null>
  ```
  
  The return value should be the export type of `moduleId`.
  
  If `exportType` is an object, it is a `"path/to/file.js": type` map.
  
  Default: `null`.

Changelog
---------

* 0.4.0 (Jun 16, 2018)

  - **Update rollup to 0.60.**
  - **Add: `options.cache`. Now the plugin would generate a cache file by default.**

* 0.3.2 (May 4, 2018)

  - Fix: `TypeError: cannot access property 'name' on undefined` in unwrapImport.

* 0.3.1 (May 1, 2018)

  - Fix: scope is not correctly analyzed in splitCodeTransformer.

* 0.3.0 (May 1, 2018)

  - Update cjs-es to 0.4.4.
  - Add: warn users for unconverted require.
  - Add: `options.nested`.
  - **Drop: `options.hoist` and `options.dynamicImport`.**

* 0.2.1 (Apr 28, 2018)

  - Update cjs-es to 0.3.2.
  - Add: include pos while reporting errors.

* 0.2.0 (Apr 28, 2018)

  - Add: `exportType` option.
  - Drop: `importStyle`, `exportStyle` option.

* 0.1.0 (Apr 27, 2018)

  - Initial releast.
