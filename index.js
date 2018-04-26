const path = require("path");

const {transform: cjsToEs} = require("cjs-es");
const {transform: cjsHoist} = require("cjs-hoist");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");

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
  
  // normalize map key to absolute path
  [options.importStyle, options.exportStyle].forEach(map => {
    if (typeof map === "object") {
      for (const key of Object.keys(map)) {
        const newKey = require.resolve(path.resolve(key));
        if (newKey !== key) {
          map[newKey] = map[key];
          delete map[key];
        }
      }
    }
  });
  
  function getPreferStyle(type, id, requireId) {
    const preferStyle = options[type + "Style"];
    if (typeof preferStyle === "string") {
      return preferStyle;
    }
    if (typeof preferStyle === "function") {
      return preferStyle(id, requireId);
    }
    if (typeof preferStyle === "object") {
      if (typeof preferStyle[id] === "string") {
        return preferStyle[id];
      }
      if (typeof preferStyle[id] === "function") {
        return preferStyle[id](requireId);
      }
      if (typeof preferStyle[id] === "object") {
        return preferStyle[id][requireId];
      }
    }
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
        const result = wrapImport({
          code,
          parse,
          shouldSplitCode: importee => {
            if (options.splitCode === "function") {
              return options.splitCode(id, importee);
            }
            return false;
          }
        });
        if (result.isTouched) {
          code = result.code;
          maps.push(result.map);
          isImportWrapped = true;
          isTouched = true;
        }
      }
      if (options.hoist) {
        const result = cjsHoist({
          code,
          parse,
          sourceMap: options.sourceMap,
          ignoreDynamicRequire: options.ignoreDynamicRequire
        });
        if (result.isTouched) {
          code = result.code;
          maps.push(result.map);
          isTouched = true;
        }
      }
      const result = cjsToEs({
        code,
        parse,
        sourceMap: options.sourceMap,
        importStyle: requireId => getPreferStyle("import", id, requireId),
        exportStyle: () => getPreferStyle("export", id)
      });
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
