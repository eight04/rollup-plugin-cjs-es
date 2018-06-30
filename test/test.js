/* eslint-env mocha */
const assert = require("assert");
const rollup = require("rollup");
const {withDir} = require("tempdir-yaml");
const endent = require("endent");
const sinon = require("sinon");

const cjsEs = require("..");

async function bundle(file, options) {
  const warns = [];
  const bundle = await rollup.rollup({
    input: [file],
    plugins: [
      cjsEs(Object.assign({cache: false, nested: true}, options))
    ],
    experimentalCodeSplitting: true,
    onwarn(warn) {
      if (warn.plugin === "rollup-plugin-cjs-es" || warn.code.startsWith("CJS_ES")) {
        warns.push(warn);
      }
    }
  });
  const modules = bundle.cache.modules.slice();
  const result = await bundle.generate({
    format: "es",
    legacy: true,
    freeze: false,
    sourcemap: true
  });
  result.warns = warns;
  result.modules = modules;
  return result;
}

describe("main", () => {
  it("warn unconverted require", () =>
    withDir(`
      - entry.js: |
          const r = require;
          r("foo");
    `, async resolve => {
      const {warns} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 1);
      assert(/Unconverted `require`/.test(warns[0].message));
      assert.equal(warns[0].pos, 10);
    })
  );
});

describe("exportType option", () => {
  it("named", () =>
    withDir(`
      - entry.js: |
          const foo = require("foo");
          module.exports = {foo};
    `, async resolve => {
      const {output} = await bundle(resolve("entry.js"));
      const {output: output2} = await bundle(resolve("entry.js"), {exportType: "named"});
      assert.equal(output["entry.js"].code, output2["entry.js"].code);
      assert.equal(output["entry.js"].code.trim(), endent`
        import * as foo from 'foo';
        export { foo };
      `);
    })
  );
  
  it("default", () =>
    withDir(`
      - entry.js: |
          const foo = require("foo");
          module.exports = {foo};
    `, async resolve => {
      const {output} = await bundle(resolve("entry.js"), {exportType: "default"});
      assert.equal(output["entry.js"].code.trim(), endent`
        import foo from 'foo';
        
        var entry = {foo};
        
        export default entry;
      `);
    })
  );
  
  it("function", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
          module.exports = {foo};
      - foo.js: |
          module.exports = {
            foo: "FOO"
          };
    `, async resolve => {
      const exportType = sinon.spy(id => {
        if (id.endsWith("entry.js")) {
          return "named";
        }
        return "default";
      });
      const {output} = await bundle(resolve("entry.js"), {exportType});
      assert.equal(exportType.callCount, 2);
      assert.equal(output["entry.js"].code.trim(), endent`
        var foo = {
          foo: "FOO"
        };
        
        export { foo };
      `);
    })
  );
    
  it("object map", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
          module.exports = {foo};
      - foo.js: |
          module.exports = {
            foo: "FOO"
          };
    `, async resolve => {
      const exportType = {
        [resolve("entry.js")]: "default",
        [resolve("foo.js")]: "named"
      };
      const {output} = await bundle(resolve("entry.js"), {exportType});
      assert.equal(output["entry.js"].code.trim(), endent`
        const _export_foo_ = "FOO";
        
        var foo = ({
          foo: _export_foo_
        });
        
        var entry = {foo};
        
        export default entry;
      `);
    })
  );
});

describe("unmatched import/export style and cache", () => {
  // warn users if the import style doesn't match the actual exports
  it("import default if importee exports default", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
      - foo.js: |
          module.exports = "foo";
    `, async resolve => {
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 1);
      assert(/foo\.js.*? doesn't export names expected by .*?entry\.js/.test(warns[0].message));
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("import default if others import default", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
          require("./bar");
      - foo.js: |
          module.exports = {
            foo: "foo"
          };
      - bar.js: |
          import foo from "./foo";
    `, async resolve => {
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 1);
      
      assert.equal(warns[0].code, "CJS_ES_MISSING_EXPORT");
      assert.equal(warns[0].importer, resolve("bar.js"));
      assert.equal(warns[0].importerExpect, "default");
      assert.equal(warns[0].exporter, resolve("foo.js"));
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("import names but others import default (bad config)", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
      - foo.js: |
          export const foo = "foo";
    `, async resolve => {
      const exportType = (id) => id.endsWith("foo.js") ? "default" : null;
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache"), exportType}));
      assert.equal(warns.length, 1);
      assert(/foo\.js' doesn't export default expected by .*?entry\.js/.test(warns[0].message));
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache"), exportType}));
      assert.equal(warns.length, 1);
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("import default but others import names (bad config)", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
          require("./bar");
      - foo.js: |
          module.exports = {foo: "foo"};
      - bar.js: |
          import {foo} from "./foo";
    `, async resolve => {
      const exportType = (id) => id.endsWith("foo.js") ? "default" : null;
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache"), exportType}));
      assert.equal(warns.length, 1);
      
      assert.equal(warns[0].code, "CJS_ES_MISSING_EXPORT");
      assert.equal(warns[0].importer, resolve("bar.js"));
      assert.equal(warns[0].importerExpect, "names");
      assert.equal(warns[0].exporter, resolve("foo.js"));
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache"), exportType}));
      assert.equal(warns.length, 1);
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("no warning if exporter exports both", () =>
    withDir(`
      - entry.js: |
          require("./foo");
          require("./bar");
      - foo.js: |
          export function foo() {}
          export default "foo";
      - bar.js: |
          const {foo} = require("./foo");
    `, async resolve => {
      {
        const {warns, modules} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")});
        assert.equal(warns.length, 0);
        const bar = modules.find(m => m.id.endsWith("bar.js"));
        assert.equal(bar.code.trim(), endent`
          import {foo} from "./foo";
        `);
      }
      // another run with cache
      {
        const {warns, modules} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")});
        assert.equal(warns.length, 0);
        const bar = modules.find(m => m.id.endsWith("bar.js"));
        assert.equal(bar.code.trim(), endent`
          import {foo} from "./foo";
        `);
      }
    })
  );
  
  it("no warning if exporter exports both (unmatched import)", () =>
    withDir(`
      - entry.js: |
          require("./bar");
          require("./baz");
      - foo.js: |
          export const foo = "foo";
          export default () => {};
      - bar.js: |
          const {foo} = require("./foo");
      - baz.js: |
          const foo = require("./foo");
          foo();
    `, async resolve => {
      {
        const {warns, modules} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")});
        assert.equal(warns.length, 0);
        
        const bar = modules.find(m => m.id.endsWith("bar.js"));
        assert.equal(bar.code.trim(), endent`
          import {foo} from "./foo";
        `);
      }
      // another run with cache, make sure bar.js is not affected by the cache.
      {
        const {warns, modules} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")});
        assert.equal(warns.length, 0);
        
        const bar = modules.find(m => m.id.endsWith("bar.js"));
        assert.equal(bar.code.trim(), endent`
          import {foo} from "./foo";
        `);
      }
    })
  );
});

describe("export table", () => {
  // use export table to decide export style
  it("export default if others import default", () =>
    withDir(`
      - entry.js: |
          import foo from "./foo";
      - foo.js: |
          exports.foo = "foo";
    `, async resolve => {
      const {warns, modules} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 0);
      assert.equal(modules[1].code.trim(), endent`
        let _exports_ = {};
        _exports_.foo = "foo";
        export default _exports_;
      `);
    })
  );
  
  it("export names if other import names", () =>
    // FIXME: since cjs-es export names by default, should we drop this test?
    withDir(`
      - entry.js: |
          import {foo} from "./foo";
      - foo.js: |
          exports.foo = "foo";
    `, async resolve => {
      const {warns, modules} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 0);
      assert.equal(modules[1].code.trim(), endent`
        const _export_foo_ = "foo";
        export {_export_foo_ as foo};
      `);
    })
  );
});
