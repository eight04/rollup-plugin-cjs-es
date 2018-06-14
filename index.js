const fs = require("fs");
const path = require("path");

const {transform: cjsEs} = require("cjs-es");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");
const {analyze: esInfoAnalyze} = require("es-info");
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

function factory(options = {}) {
  let isImportWrapped = false;
  let parse = null;
  const exportTable = {};
  const exportCache = {};
  const {_fs = fs} = options;
  
  if (typeof options.exportType === "object") {
    const newMap = {};
    for (const key of Object.keys(options.exportType)) {
      const newKey = path.resolve(key);
      newMap[newKey] = options.exportType[key];
    }
    options.exportType = newMap;
  }
  
  if (options.sourceMap == null) {
    options.sourceMap = true;
  }
  
  if (options.cache == null) {
    options.cache = true;
  }
  
  const filter = createFilter(options.include, options.exclude);
  
  if (options.cache) {
    loadCjsEsCache();
  }
  
  function loadCjsEsCache() {
    let data;
    try {
      data = _fs.readFileSync(".cjsescache", "utf8");
    } catch (err) {
      return;
    }
    data = JSON.parse(data);
    for (const [id, type] of Object.entries(data)) {
      exportCache[path.resolve(id)] = type;
    }
  }
  
  function writeCjsEsCache() {
    const data = Object.entries(exportTable).filter(e => e[1].trusted || e[1].external)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .reduce((output, [id, info]) => {
        id = path.relative(".", id).replace(/\\/g, "/");
        output[id] = info.named ? "named" : "default";
        return output;
      }, {});
    _fs.writeFileSync(".cjsescache", JSON.stringify(data, null, 2), "utf8");
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
  
  function getExportType(id) {
    // get export type from trusted table
    if (exportTable[id] && exportTable[id].trusted) {
      return exportTable[id].named ? "named" : "default";
    }
    // get export type from options
    return Promise.resolve(getExportTypeFromOptions(id))
      .then(result => {
        if (result) {
          return result;
        }
        // get export type from guess table
        if (exportTable[id]) {
          return exportTable[id].named ? "named" : "default";
        }
        // get export type from cache
        return exportCache[id];
      });
  }
  
  function updateExportTable({id, code, context, info}) {
    if (!info) {
      info = esInfoAnalyze(context.parse(code));
    }
    if (exportTable[id]) {
      if (exportTable[id].default && !info.export.default) {
        warnExport("default");
      }
      if (exportTable[id].named && !info.export.named.length && !info.export.all) {
        warnExport("names");
      }
    }
    exportTable[id] = {
      default: info.default,
      named: info.export.named.length > 0 || info.all,
      expectBy: id,
      trusted: true
    };
    return Promise.all(Object.entries(info.import).map(([name, importInfo]) => {
      return context.resolveId(name, id)
        .then(importee => {
          let external = false;
          if (!importee) {
            importee = name;
            external = true;
          }
          if (exportTable[importee]) {
            if (exportTable[importee].default && !importInfo.default) {
              warnImport(importee, "default");
            }
            if (exportTable[importee].named && !importInfo.named.length && !importInfo.all) {
              warnImport(importee, "names");
            }
          } else {
            const newGuess = {
              default: importInfo.default,
              named: importInfo.named.length > 0 || importInfo.all,
              expectBy: id,
              external
            };
            if (newGuess.default || newGuess.named) {
              exportTable[importee] = newGuess;
            }
          }
        });
    }));
    
    function warnImport(importee, type) {
      const shortId = path.relative(".", id);
      const shortImportee = path.relative(".", importee);
      const expectBy = path.relative(".", exportTable[importee].expectBy);
      context.warn(`'${expectBy}' thinks '${shortImportee}' export ${type} but '${shortId}' disagrees`);
    }
    
    function warnExport(type) {
      const shortId = path.relative(".", id);
      const expectBy = path.relative(".", exportTable[id].expectBy);
      context.warn(`'${shortId}' doesn't export ${type} expected by '${expectBy}'`);
    }
  }
  
	return {
    name: "rollup-plugin-cjs-es",
    transform(code, id) {
      if (!filter(id)) {
        return;
      }
      parse = this.parse;
      let ast = parse(code);
      const info = esInfoAnalyze(ast);
      if (isEsModule(info)) {
        return updateExportTable({context: this, info, id})
          .then(() => undefined);
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
            .then(newId => getExportType(newId || requireId)),
        exportStyle: () => getExportTypeFromOptions(id),
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
            return updateExportTable({context: this, code, id})
              .then(() => ({
                code,
                map: options.sourceMap && maps.length && joinMaps(maps)
              }));
          }
        });
    },
    transformChunk(code, {format}) {
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
    },
    buildEnd() {
      if (options.cache) {
        writeCjsEsCache();
      }
    }
  };
}

module.exports = factory;
