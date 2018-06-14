const path = require("path");
const {promisify} = require("util");

const {transform: cjsEs} = require("cjs-es");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");
const {analyze: esInfoAnalyze} = require("es-info");
const nodeResolve = promisify(require("resolve"));
const {wrapImport} = require("./lib/wrap-import");
const {unwrapImport} = require("./lib/unwrap-import");

function joinMaps(maps) {
  while (maps.length > 1) {
    maps[maps.length - 2] = mergeSourceMap(maps[maps.length - 2], maps.pop());
  }
  return maps[0];
}

function isEsModule(result) {
  return Object.keys(result.import).length ||
    result.export.default ||
    result.export.named.length ||
    result.export.all;
}

function createResolve(rollupOptions) {
  return (importee, importer) => {
    return new Promise((resolve, reject) => {
      const plugins = rollupOptions.plugins || [];
      resolveId(0);
      function resolveId(i) {
        if (i >= plugins.length) {
          const basedir = path.dirname(importer);
          nodeResolve(importee, {basedir})
            .then(resolve, reject);
          return;
        }
        if (!plugins[i].resolveId) {
          setImmediate(resolveId, i + 1);
          return;
        }
        let pending;
        try {
          pending = Promise.resolve(plugins[i].resolveId(importee, importer));
        } catch (err) {
          reject(err);
          return;
        }
        pending
          .then(result => {
            if (result) {
              resolve(result);
              return;
            }
            setImmediate(resolveId, i + 1);
          })
          .catch(reject);
      }
    });
  };  
}

function factory(options = {}) {
  let isImportWrapped = false;
  let parse = null;
  const rollupOptions = {};
  const exportTable = {};
  
  if (!options.resolve) {
    options.resolve = createResolve(rollupOptions);
  }
  
  if (typeof options.exportType === "object") {
    const newMap = {};
    for (const key of Object.keys(options.exportType)) {
      const newKey = require.resolve(path.resolve(key));
      newMap[newKey] = options.exportType[key];
    }
    options.exportType = newMap;
  }
  
  function getExportTypeFromOptions(id) {
    if (!options.exportType) {
      return;
    }
    if (typeof options.exportType === "string") {
      return options.exportType;
    }
    return typeof options.exportType === "function" ?
      options.exportType(id) : options.exportType[id];
  }
  
  function getExportTypeFromTable(id) {
    if (exportTable[id]) {
      return exportTable[id].named ? "named" : "default";
    }
  }
  
  function getExportType(id) {
    return Promise.resolve(getExportTypeFromOptions(id))
      .then(result => {
        return result ? result : getExportTypeFromTable(id);
      });
  }
  
  if (options.sourceMap == null) {
    options.sourceMap = true;
  }
  
  const filter = createFilter(options.include, options.exclude);
  
  function checkExportTable(id, context, info, trusted = false) {
    if (exportTable[id]) {
      if (exportTable[id].export.default && !info.export.default) {
        context.warn(`${id} doesn't export default expected by ${exportTable[id].expectBy}`);
      }
      if (exportTable[id].export.named && !info.export.named.length) {
        context.warn(`${id} doesn't export names expected by ${exportTable[id].expectBy}`);
      }
    }
    if (!exportTable[id] || !exportTable[id].trusted) {
      exportTable[id] = {
        default: info.default,
        named: info.named.length > 0,
        expectBy: id,
        trusted
      };
    }
  }
  
  function updateExportTable({id, code, context, info}) {
    if (!info) {
      info = esInfoAnalyze(context.parse(code))
    }
    checkExportTable(id, context, info, true);
    for (const [name, importInfo] of Object.entries(info.import)) {
      context.resolveId(name, id)
        .then(newId => {
          checkExportTable(newId, context, importInfo);
        });
    }
  }
  
	return {
    name: "rollup-plugin-cjs-es",
    options(_rollupOptions) {
      Object.assign(rollupOptions, _rollupOptions);
    },
    transform(code, id) {
      if (!filter(id)) {
        return;
      }
      parse = this.parse;
      let ast = parse(code);
      const info = esInfoAnalyze(ast);
      if (isEsModule(info)) {
        setTimeout(updateExportTable, 0, {context: this, info, id});
        return;
      }
      const maps = [];
      let isTouched;
      if (options.splitCode) {
        const result = wrapImport({
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
        if (result.isTouched) {
          code = result.code;
          maps.push(result.map);
          isImportWrapped = true;
          isTouched = true;
          ast = null;
        }
      }
      return cjsEs({
        code,
        parse,
        ast,
        sourceMap: options.sourceMap,
        importStyle: requireId => 
          this.resolveId(requireId, id)
            .then(getExportType),
        exportStyle: () => getExportType(id),
        nested: options.nested,
        warn: (message, pos) => {
          this.warn(message, pos);
        }
      })
        .then(result => {
          if (result.isTouched) {
            code = result.code;
            maps.push(result.map);
            isTouched = true;
            ast = null;
          }
          if (isTouched) {
            setTimeout(updateExportTable, 0, {context: this, code, id})
            return {
              code,
              map: options.sourceMap && maps.length && joinMaps(maps)
            };
          }
        });
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
