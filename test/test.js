/* eslint-env mocha */
const fs = require("fs");
const cjsToEs = require("..");
const rollup = require("rollup");

describe("cases", () => {
  for (const dir of fs.readdirSync(__dirname + "/cases")) {
    it(dir, () => {
      let options = readOptions();
      return rollup.rollup({
        input: [`${__dirname}/cases/${dir}/input.js`],
        plugins: [cjsToEs(options)],
        experimentalCodeSplitting: true,
        experimentalDynamicImport: true
      })
        .then(bundle => bundle.generate({
          format: "es",
          // legacy: true,
          freeze: false
        }))
        .then(result => {
          console.log(`===${dir}===`);
          console.log(result["input.js"].code);
        });
        
      function readOptions() {
        try {
          return JSON.parse(fs.readFileSync(`${__dirname}/cases/${dir}/options.js`));
        } catch (err) {
          // pass
        }
      }
    });
  }
});
