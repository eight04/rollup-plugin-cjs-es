/* eslint-env mocha */
const fs = require("fs");
const assert = require("assert");
const cjsToEs = require("..");
const rollup = require("rollup");

function bundle(file, options) {
  const codes = [];
  return rollup.rollup({
    input: [`${__dirname}/fixtures/${file}`],
    plugins: [
      cjsToEs(options),
      {transform(code) {
        codes.push(code.replace(/\r/g, ""));
      }}
    ],
    experimentalCodeSplitting: true,
    experimentalDynamicImport: true
  })
    .then(bundle => bundle.generate({
      format: "cjs",
      legacy: true,
      freeze: false,
      sourcemap: true
    }))
    .then(bundleResult => ({codes, bundleResult}));
}

function test(file, options, ...expects) {
  return bundle(file, options)
    .then(({codes}) => {
      while (expects.length) {
        assert.equal(codes.shift(), expects.shift());
      }
    });
}

function readFixture(file) {
  return fs.readFileSync(`${__dirname}/fixtures/${file}`, "utf8").replace(/\r/g, "");
}

describe("import", () => {
  it("normal", () => test("import.js", undefined, 'import * as foo from "foo";'));
  it("default comment", () =>
    test("import-default.js", undefined, 'import foo from "foo"; // default')
  );
});

describe("export", () => {
  it("normal", () => test("export.js", undefined, "export {foo};"));
  it("default comment", () =>
    test("export-default.js", undefined, "export default {foo}; // default")
  );
});

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
    bundle("entry.js", {exportType: "named"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportNamed));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportNamed));
      })
  );
  it("default", () =>
    bundle("entry.js", {exportType: "default"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportDefault));
        assert(foo.includes(fooExportDefault));
      })
  );
  it("function", () => {
    let fooCount = 0;
    const entryFile = require.resolve(`${__dirname}/fixtures/entry`);
    const fooFile = require.resolve(`${__dirname}/fixtures/foo`);
    return bundle(
      "entry.js",
      {exportType: (moduleId, importer) => {
        if (moduleId.endsWith("entry.js")) {
          assert(!importer); // no importer for entry.
          return "named";
        }
        if (moduleId.endsWith("foo.js")) {
          fooCount++;
          if (fooCount === 1) {
            assert(importer.endsWith("entry.js")); // required by entry.js
          } else if (fooCount === 2) {
            assert(!importer); // no importer when trasnforming exports.
          } else {
            throw new Error(`foo is required ${fooCount} times`);
          }
          return "default";
        }
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
    bundle("entry.js", 
      {exportType: {
        "./test/fixtures/foo": "default",
        "./test/fixtures/entry": "named"
      }}
    )
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportDefault));
      })
  );
});

describe("hoist", () => {
  const orig = readFixture("import-anywhere.js");
  const hoisted = `
import * as _require_foo_ from "foo";
if (foo) {
  const bar = _require_foo_;
}
  `.trim();
  
  it("normal", () => test("import-anywhere.js", undefined, orig));
  it("hoist", () => test("import-anywhere.js", {hoist: true}, hoisted));
});

describe("hoist dynamicImport", () => {
  const orig = readFixture("import-dynamic.js");
  const hoisted = `
import * as _require_foo_ from "foo";
Promise.resolve(_require_foo_).then(bar);
  `.trim();
  const dynamic = `
import("foo").then(bar);
  `.trim();
  
  it("normal", () => test("import-dynamic.js", undefined, orig));
  it("hoist", () => test("import-dynamic.js", {hoist: true}, hoisted));
  it("hoist + dynamic", () =>
    test("import-dynamic.js", {hoist: true, dynamicImport: true}, dynamic)
  );
});

describe("splitCode", () => {
  it("normal", () =>
    bundle("split-code-a.js", undefined).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult["split-code-a.js"];
      assert(module);
      assert.equal(module.modules.length, 1);
      assert(module.code.includes("return require"));
    })
  );
  it("hoist", () =>
    bundle("split-code-a.js", {hoist: true}).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult["split-code-a.js"];
      assert(module);
      assert.equal(module.modules.length, 2);
      assert(!module.code.includes("require("));
    })
  );
  it("splitCode", () =>
    bundle("split-code-a.js", {hoist: true, splitCode: true}).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 2);
      const moduleA = bundleResult["split-code-a.js"];
      assert(moduleA);
      assert.equal(moduleA.modules.length, 1);
      assert(moduleA.code.includes("return require"));
      const moduleB = bundleResult["split-code-b.js"];
      assert(moduleB);
      assert.equal(moduleB.modules.length, 1);
    })
  );
});
