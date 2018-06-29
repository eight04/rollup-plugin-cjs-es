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
  cache = ".cjsescache",
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
      data = _fs.readFileSync(cache, "utf8");
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
    const data = Object.entries(exportTable)
      .map(([id, info]) => {
        if (info.loaded && info.default && info.trusted) {
          return {
            id,
            expectBy: null
          };
        }
        if (info.expects) {
          const trustedExpect = info.expects.find(e => e.trusted);
          if (trustedExpect && trustedExpect.default) {
            return {
              id,
              expectBy: trustedExpect.id
            };
          }
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.id.localeCompare(b.id))
      .reduce((output, {id, expectBy}) => {
        if (expectBy) {
          expectBy = path.relative(".", expectBy).replace(/\\/g, "/");
        }
        id = path.isAbsolute(id) ? path.relative(".", id).replace(/\\/g, "/") : `~${id}`;
        output[id] = expectBy;
        return output;
      }, {});
    _fs.writeFileSync(cache, JSON.stringify(data, null, 2), "utf8");
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
        // get export type from loaded table
        if (exportTable[id] && exportTable[id].loaded) {
          return exportTable[id].named ? "named" : "default";
        }
        if (exportTable[id] && exportTable[id].expects) {
          const trustedExpect = exportTable[id].expects.find(e => e.trusted);
          if (trustedExpect) {
            return trustedExpect.named ? "named" : "default";
          }
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
    if (!exportTable[id]) {
      exportTable[id] = {id};
    }
    const exportInfo = info.export;
    exportTable[id].loaded = true;
    exportTable[id].default = exportInfo.default;
    exportTable[id].named = exportInfo.named.length > 0 || exportInfo.all;
    exportTable[id].trusted = !guessExportType.has(id);
    
    if (exportTable[id].expects) {
      for (const expect of exportTable[id].expects) {
        checkExpect(expect, exportTable[id]);
      }
    }
    
    return Promise.all(Object.entries(info.import).map(([name, importInfo]) => {
      const expect = {
        id,
        default: importInfo.default,
        named: importInfo.named.length || importInfo.all
      };
      if (!expect.default && !expect.named) {
        return;
      }
      return context.resolveId(name, id)
        .then(importee => {
          let external = false;
          if (!importee) {
            importee = name;
            external = true;
          }
          if (!exportTable[importee]) {
            exportTable[importee] = {id: importee};
          }
          if (!exportTable[importee].expects) {
            exportTable[importee].expects = [];
          }
          expect.trusted = !guessExportType.has(importee);
          expect.external = external;
          if (exportTable[importee].loaded) {
            checkExpect(expect, exportTable[importee]);
          }
          for (const otherExpect of exportTable[importee].expects) {
            if (expect.default && !otherExpect.default) {
              warnUnmatchedImport(expect.id, otherExpect.id, "default", importee);
            }
            if (expect.named && !otherExpect.named) {
              warnUnmatchedImport(expect.id, otherExpect.id, "names", importee);
            }
          }
          exportTable[importee].expects.push(expect);
        });
    }));
    
    function checkExpect(expect, exportInfo) {
      if (expect.default && !exportInfo.default) {
        warnMissingExport(expect.id, "default", exportInfo.id);
      }
      if (expect.named && !exportInfo.named) {
        warnMissingExport(expect.id, "names", exportInfo.id);
      }
    }
    
    function warnUnmatchedImport(importer, otherImporter, type, importee) {
      context.warn({
        code: "CJS_ES_UNMATCHED_IMPORT",
        message: `'${r(importer)}' expects '${r(importee)}' to export ${type} but ${r(otherImporter)} doesn't`,
        importer,
        importerExpect: type,
        otherImporter,
        importee
      });
    }
    
    function warnMissingExport(importer, type, exporter) {
      context.warn({
        code: "CJS_ES_MISSING_EXPORT",
        message: `'${r(exporter)}' doesn't export ${type} expected by '${r(importer)}'`,
        importer,
        importerExpect: type,
        exporter
      });
    }
    
    function r(id) {
      return path.relative(".", id);
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
