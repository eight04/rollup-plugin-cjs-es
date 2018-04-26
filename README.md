rollup-plugin-cjs-es
====================

Convert CommonJS module into ES module. Powered by [cjs-es](https://github.com/eight04/cjs-es) and [cjs-hoist](https://github.com/eight04/cjs-hoist).

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
      importStyle: "default",
      exportStyle: "default",
      sourceMap: true,
      splitCode: true,
      hoist: true
    })
  ]
};
```

Compatibility
-------------

`cjs-es` can only transform toplevel `require`, `exports`, and `module.exports` statements. For those non-toplevel statements, the transformer use `cjs-hoist` to hoist them to toplevel (optional, off by default):

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

With this plugin, you can use the same feature in CommonJS syntax, by writing the require statement as a promise (`Promise.resolve(require("..."))`):

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
  - `importee`: `string`. The id inside `require()` function.
  
  The return value should be a `boolean`.
  
  Default: `false`
  
* `hoist`: `boolean`. If true then enable cjs-hoist transformer. Default: `false`.
* `importStyle`: `string|object|function`. Change the importStyle option for cjs-es.

  If `importStyle` is a function, it receives 2 arguments:
  
  - `importer`: `string`. The module ID which is being transformed.
  - `importee`: `string`. The id inside `require()` function.
  
  The return value should be `"named"` or `"default"`.
  
  If `importStyle` is an object, it is a 2 depth map. For example:
  
  ```js
  importStyle: {
    "path/to/moduleA": "default", // set importStyle to "default" for moduleA
    "path/to/moduleB": {
      "./foo": "default" // set importStyle to "default" for moduleB and 
    }                    // only when requiring `./foo` module.
  }
  ```

  Default: `"named"`.
  
* `exportStyle`: `string|object|function`. Change the exportStyle option for cjs-es.

  If `exportStyle` is a function, it receives 1 argument:
  
  - `exporter`: `string`. The module ID which is being transformed.
  
  If `exportStyle` is an object, it is a `"path/to/module": "value"` map.
  
  Default: `"named"`.

Changelog
---------

* 0.1.0 (?)

  - Initial releast.
