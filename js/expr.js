/* ============================================================================
   EXPRESSIONS - the workbook's text rule language, compiled to VSM.rules JSON.
   ----------------------------------------------------------------------------
   Grammar (the specification's §3.1):

     expression := orExpr
     orExpr     := andExpr ( OR andExpr )*
     andExpr    := notExpr ( AND notExpr )*
     notExpr    := NOT? primary
     primary    := "(" expression ")" | comparison | ruleRef | TRUE | FALSE
     comparison := variable ( "=" | "!=" | IN | NOT IN | INCLUDES | INTERSECTS ) value
     value      := literal | "[" literal ("," literal)* "]"
     ruleRef    := R_[A-Za-z0-9_]*

   Compiled to the JSON js/rules.js evaluates - AND -> {all}, OR -> {any},
   INTERSECTS -> {includesAny}, a bare boolean X -> {X:true}, a rule reference
   stays a string. Compiled, never eval'd.

   Keywords are UPPERCASE, exactly as the specification writes them. This is
   load-bearing, not style: a case-insensitive AND would silently parse the
   unquoted value in  workType = Lift and shift  as "Lift" AND "shift" - a
   wrong rule with no error, which is the one thing this module must never
   produce. A lowercase connective gets a pointed error instead. Words in
   VALUE position are never keywords, so "mode = And" is the value "And".
   Values are case-sensitive strings, except the words true/false (any case),
   which become booleans. No numeric coercion: workbook cells are text and
   enum options are strings, so "5" stays "5".

   Errors are thrown with a 1-based .column so the importer and the admin
   editor can point at the offending token.
   ========================================================================== */
(function (root) {
  const VSM = root.VSM = root.VSM || {};

  const KEYWORDS = ["AND", "OR", "NOT", "IN", "INCLUDES", "INTERSECTS", "TRUE", "FALSE"];
  const err = (message, column) => Object.assign(new Error(message), { column });
  const WORD = /[A-Za-z0-9_.\-]/;

  /* ------------------------------------------------------------------ lexer */
  function lex(src) {
    const toks = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i], col = i + 1;
      if (/\s/.test(c)) { i++; continue; }
      if (c === "(") { toks.push({ t: "lparen", v: c, col }); i++; continue; }
      if (c === ")") { toks.push({ t: "rparen", v: c, col }); i++; continue; }
      if (c === "[") { toks.push({ t: "lbracket", v: c, col }); i++; continue; }
      if (c === "]") { toks.push({ t: "rbracket", v: c, col }); i++; continue; }
      if (c === ",") { toks.push({ t: "comma", v: c, col }); i++; continue; }
      if (c === "!") {
        if (src[i + 1] === "=") { toks.push({ t: "op", v: "!=", col }); i += 2; continue; }
        throw err("'!' must be part of '!='", col);
      }
      if (c === "=") { toks.push({ t: "op", v: "=", col }); i++; continue; }
      if (c === '"' || c === "'") {
        let j = i + 1;
        while (j < src.length && src[j] !== c) j++;
        if (j >= src.length) throw err("unterminated quoted value", col);
        toks.push({ t: "string", v: src.slice(i + 1, j), col });
        i = j + 1; continue;
      }
      if (WORD.test(c)) {
        let j = i;
        while (j < src.length && WORD.test(src[j])) j++;
        toks.push({ t: "word", v: src.slice(i, j), col });
        i = j; continue;
      }
      throw err("unexpected character '" + c + "'", col);
    }
    return toks;
  }

  /* ----------------------------------------------------------------- parser */
  function parse(toks, src) {
    let pos = 0;
    const refs = new Set();
    /* every comparison is recorded with its token columns, so the type checker
       can point at the exact operand instead of at the expression as a whole */
    const sites = [];

    const peek = () => toks[pos];
    const isKw = (t, k) => !!t && t.t === "word" && t.v === k;
    const endCol = () => (toks.length ? toks[toks.length - 1].col + String(toks[toks.length - 1].v).length : 1);

    function expression() {
      const parts = [andExpr()];
      while (isKw(peek(), "OR")) { pos++; parts.push(andExpr()); }
      return parts.length === 1 ? parts[0] : { any: parts };
    }
    function andExpr() {
      const parts = [notExpr()];
      while (isKw(peek(), "AND")) { pos++; parts.push(notExpr()); }
      return parts.length === 1 ? parts[0] : { all: parts };
    }
    function notExpr() {
      if (isKw(peek(), "NOT")) { pos++; return { not: notExpr() }; }
      return primary();
    }
    function primary() {
      const t = peek();
      if (!t) throw err("expected a condition here, found the end", endCol());
      if (t.t === "lparen") {
        pos++;
        const inner = expression();
        if (!peek() || peek().t !== "rparen") throw err("expected ')'", peek() ? peek().col : endCol());
        pos++;
        return inner;
      }
      if (t.t === "word") {
        if (isKw(t, "TRUE") || isKw(t, "FALSE")) {
          pos++;
          const next = peek();
          if (next && (next.t === "op" || isKw(next, "IN") || isKw(next, "INCLUDES") || isKw(next, "INTERSECTS")))
            throw err("TRUE/FALSE is a literal and takes no operator", next.col);
          return t.v.toUpperCase() === "TRUE";
        }
        if (/^R_/.test(t.v)) {
          pos++;
          const next = peek();
          if (next && (next.t === "op" || isKw(next, "IN") || isKw(next, "INCLUDES") || isKw(next, "INTERSECTS")))
            throw err("a rule reference takes no operator", next.col);
          refs.add(t.v);
          return t.v;
        }
        return comparison();
      }
      throw err("expected a condition, a rule reference or '(' here", t.col);
    }
    function comparison() {
      const name = peek(); pos++;
      refs.add(name.v);
      const t = peek();
      if (t && t.t === "op") {
        pos++;
        const v = scalar();
        sites.push({ name: name.v, op: t.v === "=" ? "eq" : "ne", values: [v], col: name.col, bare: false });
        return t.v === "=" ? { [name.v]: v } : { [name.v]: { ne: v } };
      }
      if (isKw(t, "IN")) {
        pos++;
        const vs = list("IN");
        sites.push({ name: name.v, op: "in", values: vs, col: name.col, bare: false });
        return { [name.v]: { in: vs } };
      }
      if (isKw(t, "NOT")) {
        pos++;
        if (!isKw(peek(), "IN")) throw err("expected IN after NOT", peek() ? peek().col : endCol());
        pos++;
        const vs = list("NOT IN");
        sites.push({ name: name.v, op: "notIn", values: vs, col: name.col, bare: false });
        return { [name.v]: { notIn: vs } };
      }
      if (isKw(t, "INCLUDES")) {
        pos++;
        const v = scalar();
        sites.push({ name: name.v, op: "includes", values: [v], col: name.col, bare: false });
        return { [name.v]: { includes: v } };
      }
      if (isKw(t, "INTERSECTS")) {
        pos++;
        const vs = list("INTERSECTS");
        sites.push({ name: name.v, op: "includesAny", values: vs, col: name.col, bare: false });
        return { [name.v]: { includesAny: vs } };
      }
      /* Bare boolean. A following non-connective word is an unquoted
         multi-word value, a lowercase keyword, or a typo - say so at ITS
         column, and cover both readings in one message. */
      if (t && t.t === "word" && !isKw(t, "AND") && !isKw(t, "OR")) {
        const up = t.v.toUpperCase();
        if (KEYWORDS.indexOf(up) >= 0)
          throw err("unexpected '" + t.v + "' - keywords are written in capitals (" + up + "); a multi-word value needs quotes, e.g. \"Lift and shift\"", t.col);
        throw err("unexpected '" + t.v + "' - multi-word values need quotes, e.g. \"Lift and shift\"", t.col);
      }
      if (t && (t.t === "string" || t.t === "lbracket"))
        throw err("expected an operator (=, !=, IN, INCLUDES, INTERSECTS) before this value", t.col);
      sites.push({ name: name.v, op: "eq", values: [true], col: name.col, bare: true });
      return { [name.v]: true };
    }
    function scalar() {
      const t = peek();
      if (!t || (t.t !== "word" && t.t !== "string")) throw err("expected a value", t ? t.col : endCol());
      pos++;
      if (t.t === "word" && /^(true|false)$/i.test(t.v)) return t.v.toLowerCase() === "true";
      return t.v;
    }
    function list(opName) {
      const t = peek();
      if (!t || t.t !== "lbracket") throw err(opName + " takes a bracketed list, e.g. " + opName + " [A, B]", t ? t.col : endCol());
      pos++;
      const out = [scalar()];
      while (peek() && peek().t === "comma") { pos++; out.push(scalar()); }
      if (!peek() || peek().t !== "rbracket") throw err("expected ']'", peek() ? peek().col : endCol());
      pos++;
      return out;
    }

    if (!toks.length) throw err("empty expression", 1);
    const rule = expression();
    if (pos < toks.length) {
      const t = peek(), up = t.t === "word" ? t.v.toUpperCase() : "";
      if (KEYWORDS.indexOf(up) >= 0 && !isKw(t, up))
        throw err("unexpected '" + t.v + "' - keywords are written in capitals (" + up + "); a multi-word value needs quotes, e.g. \"Lift and shift\"", t.col);
      throw err("unexpected '" + t.v + "'" + (t.t === "word" ? " - a multi-word value needs quotes" : ""), t.col);
    }
    return { rule, refs: [...refs].sort(), sites };
  }

  /* ------------------------------------------------------------ type checks
     Runs only when attribute definitions are supplied. Errors block; unknown
     ENUM VALUES are warnings, because a workbook ahead of the app's option
     list should import and say so, not refuse to load. */
  function typeCheck(sites, refs, attrDefs, ruleIds) {
    const byId = new Map((attrDefs || []).map(a => [a.id, a]));
    const rules = ruleIds ? new Set(ruleIds) : null;
    const warnings = [];

    refs.forEach(name => {
      if (/^R_/.test(name)) {
        if (rules && !rules.has(name)) {
          const n = near(name, [...rules]);
          throw err("unknown rule '" + name + "'" + (n ? " - did you mean '" + n + "'?" : ""), 1);
        }
        return;
      }
      if (!byId.has(name)) {
        const site = sites.find(s => s.name === name);
        const n = near(name, [...byId.keys()]);
        throw err("unknown attribute '" + name + "'" + (n ? " - did you mean '" + n + "'?" : ""), site ? site.col : 1);
      }
    });

    sites.forEach(s => {
      const a = byId.get(s.name);
      if (!a) return;                                        // an R_ ref never lands here
      const scalarOp = s.op === "eq" || s.op === "ne" || s.op === "in" || s.op === "notIn";
      if (a.type === "multi" && scalarOp)
        throw err("'" + s.name + "' is a multi-select; use " + s.name + " INCLUDES <value> or " + s.name + " INTERSECTS [a, b]", s.col);
      if (a.type !== "multi" && (s.op === "includes" || s.op === "includesAny"))
        throw err("INCLUDES/INTERSECTS only applies to multi-select attributes; '" + s.name + "' is " + a.type, s.col);
      if (a.type === "boolean" && !s.values.every(v => typeof v === "boolean"))
        throw err("'" + s.name + "' is a yes/no toggle; compare with true or false", s.col);
      if (a.type !== "boolean" && s.bare)
        throw err("'" + s.name + "' is a " + (a.type === "multi" ? "multi-select" : "choice") + "; write " + s.name + " = <value> or use INCLUDES", s.col);
      if (a.options && a.type !== "boolean") {
        const known = new Set(a.options.map(o => o.value));
        s.values.forEach(v => {
          if (typeof v !== "boolean" && !known.has(v))
            warnings.push("'" + v + "' is not an option of '" + s.name + "' (options: " + a.options.map(o => o.value).join(", ") + ")");
        });
      }
    });
    return warnings;
  }

  /* nearest name by lowercase equality or single-character difference */
  function near(name, candidates) {
    const low = name.toLowerCase();
    let best = null;
    for (const c of candidates) {
      const cl = c.toLowerCase();
      if (cl === low) return c;
      if (Math.abs(cl.length - low.length) > 1) continue;
      let i = 0, j = 0, diff = 0;
      while (i < low.length && j < cl.length) {
        if (low[i] === cl[j]) { i++; j++; continue; }
        diff++;
        if (diff > 1) break;
        if (low.length > cl.length) i++;
        else if (cl.length > low.length) j++;
        else { i++; j++; }
      }
      diff += (low.length - i) + (cl.length - j);
      if (diff <= 1 && !best) best = c;
    }
    return best;
  }

  function compile(text, attrDefs, ruleIds) {
    const src = String(text === undefined || text === null ? "" : text);
    const { rule, refs, sites } = parse(lex(src), src);
    const warnings = attrDefs ? typeCheck(sites, refs, attrDefs, ruleIds) : [];
    return { rule, refs, warnings };
  }

  VSM.expr = { compile, KEYWORDS };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.expr;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
