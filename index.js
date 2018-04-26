const path = require("path");

const {transform: cjsToEs} = require("cjs-es");
const {transform: cjsHoist} = require("cjs-hoist");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");

const {wrapImport, unwrapImport} = require("./lib/transform");

function factory(options = {}) {
  const name = "rollup-plugin-cjs-es";
  
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
      const maps = [];
      if (options.splitCode) {
        const result = wrapImport({
          code,
          parse: this.parse,
          shouldSplitCode: importee => {
            if (options.splitCode === "function") {
              return options.splitCode(id, importee);
            }
            return false;
          }
        });
        if (result.touched) {
          code = result.code;
          maps.push(result.map);
        }
      }
      if (options.hoist) {
        const result = cjsHoist({
          code,
          parse: this.parse,
          sourceMap: options.sourceMap,
          ignoreDynamicRequire: options.ignoreDynamicRequire
        });
        if (result.touched) {
          code = result.code;
          maps.push(result.map);
        }
      }
      const result = cjsToEs({
        code,
        parse: this.parse,
        sourceMap: options.sourceMap,
        importStyle: requireId => getPreferStyle("import", id, requireId),
        exportStyle: () => getPreferStyle("export", id)
      });
      if (result.touched) {
        code = result.code;
        maps.push(result.map);
      }
      return {
        code,
        map: options.sourceMap && maps.length ? 
          (maps.length === 1 ? maps[0] : mergeSourceMap(maps[0], maps[1])) :
          undefined
      };
    },
    transformBundle(code, {format}) {
      if (!options.splitCode) {
        return;
      }
      if (format !== "cjs") {
        throw new Error("`format` must be 'cjs'");
      }
      const result = unwrapImport({
        code,
        parse: this.parse,
        sourceMap: options.sourceMap
      });
      if (result.touched) {
        return {
          code: result.code,
          map: result.map
        };
      }
    }
  };
}

module.exports = factory;
