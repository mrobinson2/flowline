/* Tiny namespace + data registry.
   Data files call VSM.register("process" | "taxonomy" | "scenario", {...}).
   Loaded via <script> tags so the app works from file:// as well as http://.

   The engine modules (registry, schema, rules, validate, schedule, layout,
   table, import) are deliberately free of any DOM dependency, so the same
   files also load in plain Node:

       const VSM = require("./js/node.js");     // see js/node.js

   That is what lets the numbers be tested without a browser. */
(function (root) {
  const VSM = root.VSM = root.VSM || {};
  VSM.data = VSM.data || {};
  VSM.register = function (name, obj) { VSM.data[name] = obj; };
  VSM.deepClone = function (o) { return JSON.parse(JSON.stringify(o)); };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
