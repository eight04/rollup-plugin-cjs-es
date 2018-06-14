/* eslint-env mocha */
const fs = require("fs");
const assert = require("assert");
const cjsToEs = require("..");
const rollup = require("rollup");

function bundle(file, options) {
  const codes = [];
  const warns = [];
  return rollup.rollup({
    input: [`${__dirname}/fixtures/${file}`],
    plugins: [
      cjsToEs(options),
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
    bundle("export-type/entry.js", {exportType: "named"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportNamed));
        assert(entry.includes(entryExportNamed));
        assert(foo.includes(fooExportNamed));
      })
  );
  it("default", () =>
    bundle("export-type/entry.js", {exportType: "default"})
      .then(({codes: [entry, foo]}) => {
        assert(entry.includes(entryImportDefault));
        assert(entry.includes(entryExportDefault));
        assert(foo.includes(fooExportDefault));
      })
  );
  it("function", () => {
    let fooCount = 0;
    return bundle(
      "export-type/entry.js",
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
    bundle("export-type/entry.js", 
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

describe("nested", () => {
  const orig = readFixture("import-anywhere.js");
  const hoisted = `
import * as _require_foo_ from "foo";
if (foo) {
  const bar = _require_foo_;
}
  `.trim();
  
  it("false", () => test("import-anywhere.js", undefined, orig));
  it("true", () => test("import-anywhere.js", {nested: true}, hoisted));
});

describe("nested dynamicImport", () => {
  const orig = readFixture("import-dynamic.js");
  const dynamic = `
import("foo").then(bar);
  `.trim();
  
  it("false", () => test("import-dynamic.js", undefined, orig));
  it("true", () =>
    test("import-dynamic.js", {nested: true}, dynamic)
  );
});

describe("splitCode", () => {
  it("normal", () =>
    bundle("split-code/entry.js", undefined).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult.output["entry.js"];
      assert(module);
      assert.equal(Object.keys(module.modules).length, 1);
      assert(module.code.includes("return require"));
    })
  );
  it("hoist", () =>
    bundle("split-code/entry.js", {nested: true}).then(({bundleResult}) => {
      assert.equal(Object.keys(bundleResult).length, 1);
      const module = bundleResult.output["entry.js"];
      assert(module);
      assert.equal(Object.keys(module.modules).length, 2);
      assert(!module.code.includes("require("));
    })
  );
  it("splitCode", () =>
    bundle("split-code/entry.js", {nested: true, splitCode: true}).then(({bundleResult}) => {
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
    bundle("export-type-unmatched/entry.js").then(({warns}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 1);
      assert(/foo\.js doesn't export names expected by.+?entry\.js/.test(warns[0].message));
    })
  );
  
  it("get export type from table", () =>
    bundle("get-export-type-from-table/entry.js").then(({warns, codes}) => {
      warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
      assert.equal(warns.length, 0);
      assert(codes[1].includes("export default"));
    })
  );
});
