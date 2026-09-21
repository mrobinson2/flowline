/* ============================================================================
   NODE ENTRY POINT  -  the engine without a browser.
   ----------------------------------------------------------------------------
   The rendering layer needs a DOM. Everything that produces NUMBERS does not,
   and that is what this file exposes:

       const VSM = require("./js/node.js");
       const model = VSM.schedule.build(process, taxonomy, scenario, rules);
       console.log(model.metrics);

   Why this exists: it means the arithmetic can be tested from a command line -
       node test/run-tests.js
   - with no browser, no server and no install. Useful anywhere a browser is
   inconvenient, and specifically useful for debugging a real workbook on a
   machine where opening one is awkward.

   Requires Node 18 or newer (for TextDecoder, Blob, Response and
   DecompressionStream, which the .xlsx reader uses). Node 22 is what this was
   tested on.
   ========================================================================== */
require("./registry.js");
require("./units.js");
require("./schema.js");
require("./rules.js");
require("./validate.js");
require("./schedule.js");
require("./layout.js");
require("./table.js");
require("./import.js");
require("./analyze.js");
require("./export-workbook.js");
require("./embed.js");

/* the shipped data, so a test has something real to run against */
const path = require("path");
function loadData() {
  const dir = path.join(__dirname, "..", "data");
  require(path.join(dir, "taxonomy.data.js"));
  require(path.join(dir, "scenario.data.js"));
  require(path.join(dir, "process.data.js"));
  return globalThis.VSM.data;
}

const VSM = globalThis.VSM;
VSM.loadData = loadData;

/* Read an .xlsx from disk into the ArrayBuffer that VSM.table.parseXLSX wants. */
VSM.readWorkbook = function (file) {
  const buf = require("fs").readFileSync(file);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
};

module.exports = VSM;
