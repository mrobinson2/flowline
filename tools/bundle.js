/* Builds dist/flowline.html: index.html with css, data and js inlined.
   Usage: node tools/bundle.js [--fragment out.html]
   --fragment writes the page without <!DOCTYPE>/<html>/<head>/<body> (for hosts that add their own skeleton). */
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

let html = read("index.html");
html = html.replace(/<link rel="stylesheet" href="css\/app.css">/, () => "<style>\n" + read("css/app.css") + "\n</style>");
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => "<script>\n" + read(src).replace(/<\/script>/g, "<\\/script>") + "\n</script>");

const args = process.argv.slice(2);
const fi = args.indexOf("--fragment");
if (fi >= 0) {
  const out = args[fi + 1];
  const title = (html.match(/<title>[^<]*<\/title>/) || [""])[0];
  const headStyle = (html.match(/<style>[\s\S]*?<\/style>/) || [""])[0];
  const body = html.replace(/[\s\S]*<body>/, "").replace(/<\/body>[\s\S]*/, "");
  fs.writeFileSync(out, title + "\n" + headStyle + "\n" + body);
  console.log("fragment written to", out);
} else {
  fs.mkdirSync(path.join(root, "dist"), { recursive: true });
  fs.writeFileSync(path.join(root, "dist/flowline.html"), html);
  console.log("dist/flowline.html written (" + Math.round(html.length / 1024) + " KB)");
}
