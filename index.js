const path = require("path");

const {transform: cjsEs} = require("cjs-es");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");
const resolve = require("resolve");
const esInfo = require("es-info");

const {wrapImport, unwrapImport} = require("./lib/transform");

function joinMaps(maps) {
  while (maps.length > 1) {
    maps[maps.length - 2] = mergeSourceMap(maps[maps.length - 2], maps.pop());
  }
  return maps[0];
}

function isEsModule(ast) {
  const result = esInfo.analyze(ast);
  return Object.keys(result.import).length ||
    result.export.default ||
    result.export.named.length ||
    result.export.all;
}

function factory(options = {}) {
  let isImportWrapped = false;
  let parse = null;
  
  if (!options.resolve) {
    options.resolve = (importee, importer) =>
      resolve.sync(importee, {
        basedir: path.dirname(importer)
      });
  }
  
  if (typeof options.exportType === "object") {
    const newMap = {};
    for (const key of Object.keys(options.exportType)) {
      const newKey = require.resolve(path.resolve(key));
      newMap[newKey] = options.exportType[key];
    }
    options.exportType = newMap;
  }
  
  function getExportType(id, importer) {
    if (!options.exportType) {
      return;
    }
    if (typeof options.exportType === "string") {
      return options.exportType;
    }
    if (importer) {
      id = options.resolve(id, importer);
    }
    return typeof options.exportType === "function" ?
      options.exportType(id, importer) : options.exportType[id];
  }
  
  if (options.sourceMap == null) {
    options.sourceMap = true;
  }
  
  const filter = createFilter(options.include, options.exclude);
  
	return {
    name: "rollup-plugin-cjs-es",
    transform(code, id) {
      if (!filter(id)) {
        return;
      }
      parse = this.parse;
      let ast = parse(code);
      if (isEsModule(ast)) {
        return;
      }
      const maps = [];
      let isTouched;
      if (options.splitCode) {
        let result;
        try {
          result = wrapImport({
            code,
            parse,
            ast,
            shouldSplitCode: importee => {
              if (typeof options.splitCode === "function") {
                return options.splitCode(id, importee);
              }
              return false;
            }
          });
        } catch (err) {
          const pos = err.node ? err.node.start : null;
          this.error(err, pos);
          return;
        }
        if (result.isTouched) {
          code = result.code;
          maps.push(result.map);
          isImportWrapped = true;
          isTouched = true;
          ast = null;
        }
      }
      let result;
      try {
        result = cjsEs({
          code,
          parse,
          ast,
          sourceMap: options.sourceMap,
          importStyle: requireId => getExportType(requireId, id),
          exportStyle: () => getExportType(id),
          hoist: options.hoist,
          dynamicImport: options.dynamicImport
        });
      } catch (err) {
        const pos = err.node ? err.node.start : null;
        this.error(err, pos);
        return;
      }
      if (result.isTouched) {
        code = result.code;
        maps.push(result.map);
        isTouched = true;
        ast = null;
      }
      if (isTouched) {
        return {
          code,
          map: options.sourceMap && maps.length && joinMaps(maps)
        };
      }
    },
    transformBundle(code, {format}) {
      if (!isImportWrapped) {
        return;
      }
      if (format !== "cjs") {
        throw new Error("`format` must be 'cjs'");
      }
      const result = unwrapImport({
        code,
        parse,
        sourceMap: options.sourceMap
      });
      if (result.isTouched) {
        return {
          code: result.code,
          map: result.map
        };
      }
    }
  };
}

module.exports = factory;
