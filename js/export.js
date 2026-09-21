/* ============================================================================
   EXPORT  - SVG string, high-resolution PNG, clipboard.
   ========================================================================== */
VSM.exporter = (function () {
  function toSVGString(svg) {
    const clone = svg.cloneNode(true);
    clone.querySelectorAll(".vsm-hit").forEach(e => e.remove());
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    // presentation composition is always exported at its native 16:9 size
    const vb = clone.getAttribute("viewBox").split(" ").map(Number);
    clone.setAttribute("width", vb[2]);
    clone.setAttribute("height", vb[3]);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
  }

  function download(blob, filename) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function toPNGBlob(svg, scale) {
    return new Promise((resolve, reject) => {
      const str = toSVGString(svg);
      const vb = svg.getAttribute("viewBox").split(" ").map(Number);
      const w = vb[2], h = vb[3];
      const img = new Image();
      const url = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(str);
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        ctx.scale(scale, scale);
        ctx.drawImage(img, 0, 0, w, h);
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png");
      };
      img.onerror = () => reject(new Error("Could not rasterize SVG"));
      img.src = url;
    });
  }

  async function exportPNG(svg, filename, scale) {
    const blob = await toPNGBlob(svg, scale || 2);
    download(blob, filename || "value-stream.png");
    return blob;
  }

  function exportSVG(svg, filename) {
    const blob = new Blob([toSVGString(svg)], { type: "image/svg+xml;charset=utf-8" });
    download(blob, filename || "value-stream.svg");
    return blob;
  }

  async function copyPNG(svg, scale) {
    if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("Clipboard image API not available in this browser");
    const blob = await toPNGBlob(svg, scale || 2);
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    return blob;
  }

  function exportJSON(obj, filename) {
    download(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }), filename || "process.json");
  }

  return { toSVGString, toPNGBlob, exportPNG, exportSVG, copyPNG, exportJSON, download };
})();
