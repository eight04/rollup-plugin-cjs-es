const path = require("path");

const {transform: cjsEs} = require("cjs-es");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");
const resolve = require("resolve");

const {wrapImport, unwrapImport} = require("./lib/transform");

function joinMaps(maps) {
  while (maps.length > 1) {
    maps[maps.length - 2] = mergeSourceMap(maps[maps.length - 2], maps.pop());
  }
  return maps[0];
}

function factory(options = {}) {
  const name = "rollup-plugin-cjs-es";
  let isImportWrapped = false;
  let parse = null;
  
  if (typeof options.exportType === "object") {
    for (const key of Object.keys(options.exportType)) {
      const newKey = resolve.sync(key, {basedir: process.cwd()});
      if (newKey !== key) {
        options.exportType[newKey] = options.exportType[key];
        delete options.exportType[key];
      }
    }
  }
  
  function getExportType(id, importer) {
    if (!options.exportType) {
      return;
    }
    if (typeof options.exportType === "string") {
      return options.exportType;
    }
    if (importer) {
      id = resolve.sync(id, {
        basedir: path.dirname(importer)
      });
    }
    return typeof options.exportType === "function" ?
      options.exportType(id, importer) : options.exportType[id];
  }
  
  if (options.sourceMap == null) {
    options.sourceMap = true;
  }
  
  const filter = createFilter(options.include, options.exclude);
  
	return {
    name,
    transform(code, id) {
      if (!filter(id)) {
        return;
      }
      parse = this.parse;
      const maps = [];
      let isTouched;
      if (options.splitCode) {
        let result;
        try {
          result = wrapImport({
            code,
            parse,
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
        }
      }
      let result;
      try {
        result = cjsEs({
          code,
          parse,
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
