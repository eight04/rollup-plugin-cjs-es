/* eslint-env mocha */
const assert = require("assert");
const cjsEs = require("..");
const rollup = require("rollup");

function bundle(dir, options) {
  const codes = [];
  const warns = [];
  return rollup.rollup({
    input: [`${__dirname}/fixtures/${dir}/entry.js`],
    plugins: [
      cjsEs(Object.assign({cache: false}, options)),
      {transform(code) {
        codes.push(code.replace(/\r/g, ""));
      }}
    ],
    experimentalCodeSplitting: true,
    onwarn(warn) {
      warns.push(warn);
    }
  })
    .then(bundle => bundle.generate({
      format: "cjs",
      legacy: true,
      freeze: false,
      sourcemap: true
    }))
    .then(bundleResult => ({codes, warns, bundleResult}));
}

describe("exportType", () => {
  const entryImportNamed = 'import * as foo from "./foo"';
  const entryImportDefault = 'import foo from "./foo"';
  const entryExportNamed = "export {foo}";
  const entryExportDefault = "export default {foo}";
  const fooExportNamed = `
const _export_foo_ = () => console.log("foo");
export {_export_foo_ as foo};
  `.trim();
  const fooExportDefault = `
export default {
  foo: () => console.log("foo")
};
  `.trim();
  it("named", () => 
    bundle("export-type", {exportType: "named"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportNamed));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportNamed));
      })
  );
  it("default", () =>
    bundle("export-type", {exportType: "default"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportDefault));
        assert(foo.includes(fooExportDefault));
      })
  );
  it("function", () => {
    let fooCount = 0;
    return bundle(
      "export-type",
      {exportType: (moduleId) => {
        if (moduleId.endsWith("entry.js")) {
          return "named";
        }
        if (moduleId.endsWith("foo.js")) {
          fooCount++;
          assert(fooCount <= 2);
          return "default";
        }
        throw new Error(`Unknown moduleId ${moduleId}`);
      }}
    )
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportDefault));
        assert.equal(fooCount, 2);
      });
  });
  it("object map", () =>
    bundle("export-type", 
      {exportType: {
        "./test/fixtures/export-type/foo.js": "default",
        "./test/fixtures/export-type/entry.js": "named"
      }}
    )
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportDefault));
      })
  );
});

describe("splitCode", () => {
  it("normal", () =>
    bundle("split-code", undefined).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult.output["entry.js"];
      assert(module);
      assert.equal(Object.keys(module.modules).length, 1);
      assert(module.code.includes("return require"));
    })
  );
  it("hoist", () =>
    bundle("split-code", {nested: true}).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult.output["entry.js"];
      assert(module);
      assert.equal(Object.keys(module.modules).length, 2);
      assert(!module.code.includes("require("));
    })
  );
  it("splitCode", () =>
    bundle("split-code", {nested: true, splitCode: true}).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult.output).length, 2);
      const moduleA = bundleResult.output["entry.js"];
      assert(moduleA);
      assert.equal(Object.keys(moduleA.modules).length, 1);
      assert(moduleA.code.includes("return require"));
      const moduleB = bundleResult.output["foo.js"];
      assert(moduleB);
      assert.equal(Object.keys(moduleB.modules).length, 1);
    })
  );
});

describe("export table", () => {
  it("export type unmatched", () =>
    bundle("export-type-unmatched").then(({warns}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 1);
      assert(/foo\.js' doesn't export names expected by.+?entry\.js/.test(warns[0].message));
    })
  );
  
  it("export type unmatched default", () =>
    bundle("export-type-unmatched-default").then(({warns}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 1);
      assert(/foo\.js' doesn't export default expected by.+?entry\.js/.test(warns[0].message));
    })
  );
  
  it("export type disagree", () =>
    bundle("export-type-disagree").then(({warns}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 1);
      assert(/entry\.js' thinks 'external' export names but.+?foo\.js' disagrees/.test(warns[0].message));
    })
  );
  
  it("export type disagree default", () =>
    bundle("export-type-disagree-default").then(({warns}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 1);
      assert(/foo\.js' thinks 'external' export default but.+?bar\.js' disagrees/.test(warns[0].message));
    })
  );
});
