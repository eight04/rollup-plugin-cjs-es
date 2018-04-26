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
      hoist: true,
      ignoreDynamicRequire: true
    })
  ]
};
```

Compatibility
-------------

`cjs-es` can only transform toplevel `require`, `exports`, and `module.exports` statements. For those non-toplevel statements, the transformer use `cjs-hoist` to hoist them to toplevel (optional):

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

Or, by adding a special comment `// split` if you can't use async function:

```js
module.exports = {
  foo: () => {
    return require("./bar"); // split
  }
};
```

Note that in the later form, the result is a sync `require` function call, which means **the output format must be `cjs`**.

Changelog
---------

* 0.1.0 (?)

  - Initial releast.
