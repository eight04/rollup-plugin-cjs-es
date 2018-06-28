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

describe("cache", () => {
  function prepareFs() {
    const files = {};
    const fs = {
      readFileSync(file) {
        if (!files[file]) {
          throw new Error("not found");
        }
        return files[file];
      },
      writeFileSync(file, data) {
        files[file] = data;
      },
      files
    };
    return fs;
  }
  
  it("hoisted default export should be trusted", () => {
    const fs = prepareFs();
    return bundle("cjs-import-default", {cache: true, _fs: fs})
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 1);
        return bundle("cjs-import-default", {cache: true, _fs: fs});
      })
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 0);
      });
  });
  
  it("es module should be trusted", () => {
    const fs = prepareFs();
    return bundle("es-import-cjs", {cache: true, _fs: fs})
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 2);
        return bundle("es-import-cjs", {cache: true, _fs: fs});
      })
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 0);
      });
  });
  
  it("es module should be trusted (disagree external)", () => {
    const fs = prepareFs();
    return bundle("es-disagree-external", {cache: true, _fs: fs})
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 1);
        return bundle("es-disagree-external", {cache: true, _fs: fs});
      })
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 0);
      });
  });
  
  it("options has higher priority even if it makes no sense", () => {
    const fs = prepareFs();
    const exportType = (id) => id === "external" ? "default" : null;
    return bundle("es-disagree-external-default", {cache: true, _fs: fs, exportType})
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 1);
        return bundle("es-disagree-external-default", {cache: true, _fs: fs, exportType});
      })
      .then(({warns}) => {
        warns = warns.filter(w => w.plugin == "rollup-plugin-cjs-es");
        assert.equal(warns.length, 1);
      });
  });
});
