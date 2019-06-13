/* eslint-env mocha */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const rollup = require("rollup");
const {withDir} = require("tempdir-yaml");
const endent = require("endent");
const sinon = require("sinon");

const cjsEs = require("..");

async function bundle(file, options, rollupOptions = {}) {
  const warns = [];
  const systemWarns = [];
  const bundle = await rollup.rollup({
    input: [file],
    plugins: [
      cjsEs(Object.assign({cache: false, nested: true}, options))
    ],
    onwarn(warn) {
      if (warn.code === "PLUGIN_WARNING") {
        warns.push(warn);
      } else {
        systemWarns.push(warn);
      }
    },
    ...rollupOptions
  });
  const modules = bundle.cache.modules.slice();
  const result = await bundle.generate({
    format: "es",
    legacy: true,
    freeze: false,
    sourcemap: true
  });
  result.warns = warns;
  result.systemWarns = systemWarns;
  result.modules = modules;
  result.namedOutput = result.output.reduce(
    (o, output) => {
      o[output.fileName] = output;
      return o;
    },
    {}
  );
  result.namedModules = result.modules.reduce(
    (o, m) => {
      o[m.id.match(/[^\\/]+$/)[0]] = m;
      return o;
    },
    {}
  );
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
      const {namedOutput: output} = await bundle(resolve("entry.js"));
      const {namedOutput: output2} = await bundle(resolve("entry.js"), {exportType: "named"});
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
      const {namedOutput: output} = await bundle(resolve("entry.js"), {exportType: "default"});
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
      const {namedOutput: output} = await bundle(resolve("entry.js"), {exportType});
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
      const {namedOutput: output} = await bundle(resolve("entry.js"), {exportType});
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
  it("warn if import names and importee exports default", () =>
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
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("warn if import names and importee exports default (force)", () =>
    withDir(`
      - entry.js: |
          import {foo} from "./foo.js";
      - foo.js: |
          module.exports = "foo";
    `, async resolve => {
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 1);
      assert(/foo\.js.*? doesn't export names expected by .*?entry\.js/.test(warns[0].message));
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 1);
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 1);
    })
  );
  
  it("don't warn with bare import", () =>
    withDir(`
      - entry.js: |
          import "./foo.js";
      - foo.js: |
          module.exports = "foo";
    `, async resolve => {
      let warns;
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("don't warn with bare import (name)", () =>
    withDir(`
      - entry.js: |
          import "./foo.js";
      - foo.js: |
          exports.foo = "foo";
    `, async resolve => {
      let warns;
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
      
      assert.equal(warns[0].pluginCode, "CJS_ES_MISSING_EXPORT");
      assert.equal(warns[0].importer, resolve("bar.js"));
      assert.equal(warns[0].importerExpect, "default");
      assert.equal(warns[0].exporter, resolve("foo.js"));
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
    })
  );
  
  it("import default if the name is missing and the name is an object method", () =>
    withDir(`
      - entry.js: |
          const foo = require("./foo");
          console.log(foo.hasOwnProperty("foo"));
      - foo.js: |
          module.exports = {
            foo: "foo"
          };
    `, async resolve => {
      let systemWarns;
      ({systemWarns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(systemWarns.length, 1);
      
      assert.equal(systemWarns[0].code, "MISSING_EXPORT");
      assert.equal(path.resolve(systemWarns[0].importer), resolve("entry.js"));
      assert.equal(systemWarns[0].missing, "hasOwnProperty");
      assert.equal(path.resolve(systemWarns[0].exporter), resolve("foo.js"));
      
      ({systemWarns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(systemWarns.length, 0);
      
      ({systemWarns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(systemWarns.length, 0);
    })
  );
  
  it("warn if import default and importee export names (bad config)", () =>
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
      
      assert.equal(warns[0].pluginCode, "CJS_ES_MISSING_EXPORT");
      assert.equal(warns[0].importer, resolve("bar.js"));
      assert.equal(warns[0].importerExpect, "names");
      assert.equal(warns[0].exporter, resolve("foo.js"));
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache"), exportType}));
      assert.equal(warns.length, 1);
      
      ({warns} = await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")}));
      assert.equal(warns.length, 0);
      
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
  
  it("warn not-loaded modules", () =>
    withDir(`
      - entry.js: |
          const foo = require("foo");
          require("./bar");
      - bar.js: |
          const foo = require("foo");
          foo();
    `, async resolve => {
      const {warns} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 1);
      assert.equal(warns[0].pluginCode, "CJS_ES_NOT_LOADED");
      assert.equal(warns[0].moduleId, "foo");
    })
  );
  
  it("ignore externals", () =>
    withDir(`
      - entry.js: |
          const foo = require("foo");
          require("./bar");
      - bar.js: |
          const foo = require("foo");
          foo();
    `, async resolve => {
      const {warns} = await bundle(resolve("entry.js"), {}, {external: ["foo"]});
      assert.equal(warns.length, 0);
    })
  );
  
  it("the cache is ordered", () =>
    withDir(`
      - entry.js: |
          require("./foo");
          require("./bar");
      - foo.js: |
          module.exports = "foo";
      - bar.js: |
          module.exports = "bar";
    `, async resolve => {
      await bundle(resolve("entry.js"), {cache: resolve(".cjsescache")});
      const cache = JSON.parse(fs.readFileSync(resolve(".cjsescache"), "utf8"));
      assert(cache[0].endsWith("bar.js"));
      assert(cache[1].endsWith("foo.js"));
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
      const {warns, namedModules} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 0);
      assert(/export .+ as default/.test(namedModules["foo.js"].code));
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
      const {warns, namedModules} = await bundle(resolve("entry.js"));
      assert.equal(warns.length, 0);
      assert(/export .+ as foo/.test(namedModules["foo.js"].code));
    })
  );
});
