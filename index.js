const fs = require("fs");
const path = require("path");

const {transform: cjsEs} = require("cjs-es");
const {createFilter} = require("rollup-pluginutils");
const {analyze: esInfoAnalyze} = require("es-info");

function isEsModule(result) {
  return Object.keys(result.import).length ||
    result.export.default ||
    result.export.named.length ||
    result.export.all;
}

function factory({
  include = null,
  exclude = null,
  cache = true,
  sourceMap = true,
  nested = false,
  exportType = null,
  _fs = fs
}) {
  const exportTypeCache = {};
  const exportTable = {};
  const exportCache = {};
  const filter = createFilter(include, exclude);
  
  if (exportType && typeof exportType === "object") {
    const newMap = {};
    for (const key of Object.keys(exportType)) {
      const newKey = path.resolve(key);
      newMap[newKey] = exportType[key];
    }
    exportType = newMap;
  }
  
  if (cache) {
    loadCjsEsCache();
  }
  
  return {
    name: "rollup-plugin-cjs-es",
    transform,
    buildEnd
  };
  
  function loadCjsEsCache() {
    let data;
    try {
      data = _fs.readFileSync(".cjsescache", "utf8");
    } catch (err) {
      return;
    }
    data = JSON.parse(data);
    for (const [id, expectBy] of Object.entries(data)) {
      exportCache[id[0] === "~" ? id.slice(1) : path.resolve(id)] =
        expectBy ? path.resolve(expectBy) : null;
    }
  }
  
  function writeCjsEsCache() {
    const data = Object.entries(exportTable).filter(([, i]) => i.default && (i.trusted || i.external))
      .sort((a, b) => a[0].localeCompare(b[0]))
      .reduce((output, [id, {expectBy}]) => {
        if (expectBy === id) {
          expectBy = null;
        } else {
          expectBy = path.relative(".", expectBy).replace(/\\/g, "/");
        }
        id = path.isAbsolute(id) ? path.relative(".", id).replace(/\\/g, "/") : `~${id}`;
        output[id] = expectBy;
        return output;
      }, {});
    _fs.writeFileSync(".cjsescache", JSON.stringify(data, null, 2), "utf8");
  }
  
  function getExportTypeFromOptions(id) {
    if (!exportType) {
      return;
    }
    if (typeof exportType === "string") {
      return exportType;
    }
    if (typeof exportType === "object") {
      return exportType[id];
    }
    if (exportTypeCache.hasOwnProperty(id)) {
      return exportTypeCache[id];
    }
    return Promise.resolve(exportType(id))
      .then(result => {
        if (result) {
          exportTypeCache[id] = result;
        }
        return result;
      });
  }
  
  function getExportType(id, importer = null) {
    // get export type from options
    return Promise.resolve(getExportTypeFromOptions(id))
      .then(result => {
        if (result) {
          return result;
        }
        // get export type from trusted table
        if (exportTable[id] && exportTable[id].trusted) {
          return exportTable[id].named ? "named" : "default";
        }
        // check if id is in preferDefault cache
        if (exportCache.hasOwnProperty(id) && exportCache[id] !== importer) {
          return "default";
        }
      });
  }
  
  function updateExportTable({id, code, context, info, guessExportType}) {
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
    if (!exportTable[id] || !guessExportType.has(id)) {
      const exportInfo = info.export;
      exportTable[id] = {
        default: exportInfo.default,
        named: exportInfo.named.length > 0 || exportInfo.all,
        expectBy: id,
        trusted: !guessExportType.has(id)
      };
    }
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
          }
          if (!exportTable[importee] || !guessExportType.has(importee)) {
            exportTable[importee] = {
              default: importInfo.default,
              named: importInfo.named.length > 0 || importInfo.all,
              expectBy: id,
              external,
              trusted: !guessExportType.has(importee)
            };
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
  
	function transform(code, id) {
    if (!filter(id)) {
      return;
    }
    const ast = this.parse(code);
    const guessExportType = new Set;
    const info = esInfoAnalyze(ast);
    if (isEsModule(info)) {
      return updateExportTable({context: this, info, id, guessExportType})
        .then(() => undefined);
    }
    return cjsEs({
      code,
      ast,
      sourceMap,
      importStyle: requireId => 
        this.resolveId(requireId, id)
          .then(newId => {
            guessExportType.add(newId || requireId);
            return getExportType(newId || requireId, id);
          }),
      exportStyle: () => {
        guessExportType.add(id);
        return getExportType(id);
      },
      nested,
      warn: (message, pos) => {
        this.warn(message, pos);
      }
    })
      .then(({code, map, isTouched}) => {
        if (isTouched) {
          return updateExportTable({context: this, code, id, guessExportType})
            .then(() => ({
              code,
              map
            }));
        }
      });
  }
  
  function buildEnd() {
    if (cache) {
      writeCjsEsCache();
    }
  }
}

module.exports = factory;
