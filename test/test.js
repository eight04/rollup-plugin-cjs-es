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
        codes.push(code);
      }}
    ],
    experimentalCodeSplitting: true,
    experimentalDynamicImport: true
  })
    .then(bundle => bundle.generate({
      format: "es",
      legacy: true,
      freeze: false
    }))
    .then(bundleResult => ({codes, bundleResult}));
}

function test(file, options, expect) {
  return bundle(file, options)
    .then(({codes: [code]}) => {
      assert.equal(code.replace(/\r/g, ""), expect);
    });
}

function readFixture(file) {
  return fs.readFileSync(`${__dirname}/fixtures/${file}`, "utf8").replace(/\r/g, "");
}

describe("importStyle", () => {
  it("normal", () => test("import.js", undefined, 'import * as foo from "foo";'));
  it("default comment", () =>
    test("import-default.js", undefined, 'import foo from "foo"; // default')
  );
  it("string", () => 
    test("import.js", {importStyle: "default"}, 'import foo from "foo";')
  );
  it("function", () => 
    test(
      "import.js",
      {importStyle: (importer, importee) => {
        assert(importer.endsWith("import.js"));
        assert.equal(importee, "foo");
        return "default";
      }},
      'import foo from "foo";'
    )
  );
  it("map", () =>
    test(
      "import.js",
      {importStyle: {
        [`${__dirname}/fixtures/import.js`]: "default"
      }},
      'import foo from "foo";'
    )
  );
  it("map with function", () => 
    test(
      "import.js",
      {importStyle: {
        [`${__dirname}/fixtures/import.js`]: importee => {
          assert.equal(importee, "foo");
          return "default";
        }
      }},
      'import foo from "foo";'
    )
  );
  it("map with map", () => 
    test(
      "import.js",
      {importStyle: {
        [`${__dirname}/fixtures/import.js`]: {
          "foo": "default"
        }
      }},
      'import foo from "foo";'
    )
  );
});

describe("exportStyle", () => {
  it("normal", () => test("export.js", undefined, "export {foo};"));
  it("default comment", () =>
    test("export-default.js", undefined, "export default {foo}; // default")
  );
  it("string", () =>
    test("export.js", {exportStyle: "default"}, "export default {foo};")
  );
  it("function", () =>
    test("export.js", {exportStyle: exporter => {
      assert(exporter.endsWith("export.js"));
      return "default";
    }}, "export default {foo};")
  );
  it("map", () => 
    test("export.js", {
      exportStyle: {
        [`${__dirname}/fixtures/export.js`]: "default"
      }
    }, "export default {foo};")
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

describe("hoist ignoreDynamicRequire", () => {
  const hoisted = `
import * as _require_foo_ from "foo";
Promise.resolve(_require_foo_).then(bar);
  `.trim();
  const ignored = `
import("foo").then(bar);
  `.trim();
  
  it("normal", () => test("import-dynamic.js", undefined, ignored));
  it("hoist", () => test("import-dynamic.js", {hoist: true}, ignored));
  it("hoist no ignore", () =>
    test("import-dynamic.js", {
      hoist: true,
      ignoreDynamicRequire: false
    }, hoisted)
  );
});
