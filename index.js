const path = require("path");
const {promisify} = require("util");

const {transform: cjsEs} = require("cjs-es");
const mergeSourceMap = require("merge-source-map");
const {createFilter} = require("rollup-pluginutils");
const esInfo = require("es-info");
const nodeResolve = promisify(require("resolve"));
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
  
  function getExportType(id, importer) {
    if (!options.exportType) {
      return;
    }
    if (typeof options.exportType === "string") {
      return options.exportType;
    }
    return Promise.resolve(importer ? options.resolve(id, importer) : id)
      .then(id => {
        return typeof options.exportType === "function" ?
          options.exportType(id, importer) : options.exportType[id];
      });
  }
  
  if (options.sourceMap == null) {
    options.sourceMap = true;
  }
  
  const filter = createFilter(options.include, options.exclude);
  
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
      return cjsEs({
        code,
        parse,
        ast,
        sourceMap: options.sourceMap,
        importStyle: requireId => getExportType(requireId, id),
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
