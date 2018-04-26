rollup-plugin-cjs-es
====================

Convert CommonJS module into ES module. Powered by [cjs-es][1] and [cjs-hoist][2].

[1]: https://github.com/eight04/cjs-es
[2]: https://github.com/eight04/cjs-hoist

Usage
-----

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
