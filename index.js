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
} = {}) {
  const cjsEsCache = new Set;
  const exportTypeCache = {};
  const exportTable = {};
  const filter = createFilter(include, exclude);
  
  if (exportType && typeof exportType === "object") {
    resolveRelPathInExportType();
  }
  
  if (cache) {
    loadCjsEsCache();
  }
  
  return {
    name: "rollup-plugin-cjs-es",
    transform,
    buildEnd
  };
  
  function resolveRelPathInExportType() {
    const newMap = {};
    for (const key of Object.keys(exportType)) {
      const newKey = path.resolve(key);
      newMap[newKey] = exportType[key];
    }
    exportType = newMap;
  }
  
  function loadCjsEsCache() {
    let data;
    try {
      data = _fs.readFileSync(cache, "utf8");
    } catch (err) {
      return;
    }
    data = JSON.parse(data);
    for (const id of data) {
      const absId = id[0] === "~" ? id.slice(1) : path.resolve(id);
      cjsEsCache.add(absId);
    }
  }
  
  function writeCjsEsCache() {
    const data = Object.entries(exportTable)
      .filter(([, info]) => {
        if (info.trusted) {
          // ES modules or CJS modules that is impossible to export names
          if (info.default && !info.named.length) {
            return true;
          }
          return false;
        }
        if (info.expects) {
          const trustedExpect = info.expects.find(e => e.trusted);
          // FIXME: is it possible that someone imports named/default at the same time?
          if (trustedExpect && trustedExpect.default) {
            return true;
          }
          // find missing names
          // FIXME: should we check if the missing name is an object property?
          // https://github.com/eight04/rollup-plugin-cjs-es/issues/12
          if (info.loaded && info.exportedProps) {
            const expect = info.expects.find(e => 
              e.importedProps && e.importedProps.some(n => !info.exportedProps.includes(n))
            );
            if (expect) {
              return true;
            }
          }
        }
        return false;
      })
      .map(([id]) =>
        path.isAbsolute(id) ?
          path.relative(".", id).replace(/\\/g, "/") :
          `~${id}`
      )
      .sort((a, b) => a.localeCompare(b));
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
  
  async function getExportType(id) {
    // get export type from options
    const result = await getExportTypeFromOptions(id);
    if (result) {
      return result;
    }
    // get export type from loaded table
    if (exportTable[id] && exportTable[id].loaded) {
      return exportTable[id].named.length ? "named" : "default";
    }
    if (exportTable[id] && exportTable[id].expects) {
      for (const expect of exportTable[id].expects) {
        if (expect.default) {
          return "default";
        }
        if (expect.named.length || expect.all) {
          return "named";
        }
      }
    }
    // check if id is in preferDefault cache
    if (cjsEsCache.has(id)) {
      return "default";
    }
  }
  
  async function updateEsExportTable({id, context, info}) {
    if (!exportTable[id]) {
      exportTable[id] = {id};
    }
    Object.assign(exportTable[id], info.export);
    exportTable[id].trusted = true;
    exportTable[id].loaded = true;
    
    await Promise.all(Object.entries(info.import).map(async ([name, importInfo]) => {
      if (!importInfo.default && !importInfo.named.length && !importInfo.all) {
        return;
      }
      importInfo.id = id;
      importInfo.trusted = true;
      let importee = await context.resolveId(name, id);
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
      importInfo.external = external;
      exportTable[importee].expects.push(importInfo);
    }));
  }
  
  async function updateCjsExportTable({
    id,
    context,
    transformContext: {
      importedProperties,
      namedExports,
      objectExports,
      finalExportType,
      finalImportType
    },
    guessedIds
  }) {
    if (!exportTable[id]) {
      exportTable[id] = {id};
    }
    const props = new Set([...namedExports.keys(), ...objectExports.keys()]);
    exportTable[id].default = finalExportType === "default";
    exportTable[id].named = finalExportType === "named" ? [...props] : [];
    exportTable[id].exportedProps = [...props];
    exportTable[id].loaded = true;
    exportTable[id].trusted = !guessedIds.has(id);
    
    await Promise.all(Object.entries(finalImportType).map(async ([name, type]) => {
      const props = importedProperties.get(name) || [];
      const importInfo = {
        id,
        named: type === "named" ? [...props] : [],
        default: type === "default",
        all: type === "named" && !props.length,
        importedProps: [...props]
      };
      let importee = await context.resolveId(name, id);
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
      importInfo.external = external;
      importInfo.trusted = !guessedIds.has(importee);
      exportTable[importee].expects.push(importInfo);
    }));
  }
  
	async function transform(code, id) {
    if (!filter(id)) {
      return;
    }
    const ast = this.parse(code);
    const info = esInfoAnalyze({ast});
    if (isEsModule(info)) {
      await updateEsExportTable({context: this, info, id});
      return;
    }
    const guessedIds = new Set;
    const result = await cjsEs({
      code,
      ast,
      sourceMap,
      importStyle: async requireId => {
        const absId = await this.resolveId(requireId, id);
        guessedIds.add(absId);
        return getExportType(absId || requireId, id);
      },
      exportStyle: () => {
        guessedIds.add(id);
        return getExportType(id);
      },
      nested,
      warn: (message, pos) => {
        this.warn(message, pos);
      }
    });
    if (result.isTouched) {
      await updateCjsExportTable({
        context: this,
        id,
        transformContext: result.context,
        guessedIds
      });
      return {
        code: result.code,
        map: result.map
      };
    }
  }
  
  function buildEnd() {
    // warn missing exports
    for (const exportInfo of Object.values(exportTable)) {
      if (!exportInfo.expects) {
        continue;
      }
      if (!exportInfo.loaded) {
        if (!this.isExternal(exportInfo.id)) {
          this.warn({
            code: "CJS_ES_NOT_LOADED",
            moduleId: exportInfo.id,
            message: `${r(exportInfo.id)} is not loaded.`
          });
        }
        continue;
      }
      for (const expect of exportInfo.expects) {
        const warning = checkExpect(expect, exportInfo);
        if (warning) {
          this.warn(warning);
        }
      }
    }
    
    if (cache) {
      writeCjsEsCache();
    }
  }
  
  function checkExpect(expect, exportInfo) {
    if (expect.default && !exportInfo.default) {
      return missingExportWarning(expect.id, "default", exportInfo.id);
    }
    if ((expect.named.length || expect.all) && !exportInfo.named.length && !exportInfo.all) {
      return missingExportWarning(expect.id, "names", exportInfo.id);
    }
  }

  function missingExportWarning(importer, type, exporter) {
    return {
      code: "CJS_ES_MISSING_EXPORT",
      message: `'${r(exporter)}' doesn't export ${type} expected by '${r(importer)}'`,
      importer,
      importerExpect: type,
      exporter
    };
  }

  function r(id) {
    return path.relative(".", id);
  }
}

module.exports = factory;
