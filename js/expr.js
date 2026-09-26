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

  /* nearest name: case-only difference, one edit, or a one-edit prefix of a
     longer candidate (so 'Hostng' finds 'HostingTarget'). */
  function near(name, candidates) {
    const low = name.toLowerCase();
    const d1 = (a, b) => {                                   // edit distance <= 1
      if (a === b) return true;
      if (Math.abs(a.length - b.length) > 1) return false;
      let i = 0, j = 0, diff = 0;
      while (i < a.length && j < b.length) {
        if (a[i] === b[j]) { i++; j++; continue; }
        if (++diff > 1) return false;
        if (a.length > b.length) i++;
        else if (b.length > a.length) j++;
        else { i++; j++; }
      }
      return diff + (a.length - i) + (b.length - j) <= 1;
    };
    for (const c of candidates) if (c.toLowerCase() === low) return c;
    for (const c of candidates) if (d1(low, c.toLowerCase())) return c;
    if (low.length >= 5) {
      for (const c of candidates) {
        const cl = c.toLowerCase();
        if (cl.length > low.length &&
            (d1(low, cl.slice(0, low.length)) || d1(low, cl.slice(0, low.length + 1)))) return c;
      }
    }
    return null;
  }

  /* ------------------------------------------------------------------ print
     A compiled rule back as canonical text, for the admin editor. Shapes the
     grammar cannot say (numeric comparisons, includesAll, array shorthand,
     values containing double quotes) throw "not representable" - the editor
     falls back to showing the JSON. Precedence: OR(1) < AND(2) < NOT(3). */
  function print(rule) {
    const bad = what => { throw new Error("not representable as an expression: " + what); };
    const value = v => {
      if (typeof v === "boolean") return String(v);
      const s = String(v);
      if (/^[A-Za-z0-9_.\-]+$/.test(s) && KEYWORDS.indexOf(s.toUpperCase()) < 0 && !/^(true|false)$/i.test(s)) return s;
      if (s.indexOf('"') >= 0) bad("a value containing double quotes");
      return '"' + s + '"';
    };
    const list = vs => "[" + vs.map(value).join(", ") + "]";
    const walk = (r, parent) => {                            // parent = surrounding precedence
      const paren = (text, mine) => (mine < parent ? "(" + text + ")" : text);
      if (r === true) return "TRUE";
      if (r === false) return "FALSE";
      if (typeof r === "string") return r;
      if (Array.isArray(r) || r === null || typeof r !== "object") bad(JSON.stringify(r));
      const keys = Object.keys(r);
      if (keys.length === 1 && (keys[0] === "all" || keys[0] === "any" || keys[0] === "not")) {
        if (keys[0] === "not") return paren("NOT " + walk(r.not, 3), 3);
        const mine = keys[0] === "all" ? 2 : 1;
        return paren(r[keys[0]].map(x => walk(x, mine)).join(keys[0] === "all" ? " AND " : " OR "), mine);
      }
      /* comparison object; several keys mean AND of the pairs */
      const parts = keys.map(k => {
        const v = r[k];
        if (v === true) return k;
        if (v === false || typeof v === "string" || typeof v === "number") return k + " = " + value(v);
        if (Array.isArray(v)) bad("the array shorthand on '" + k + "'");
        if (v === null || typeof v !== "object") bad(JSON.stringify(v));
        const ops = Object.keys(v);
        if (ops.length !== 1) bad("several operators on '" + k + "'");
        const arg = v[ops[0]];
        switch (ops[0]) {
          case "ne": return k + " != " + value(arg);
          case "in": return k + " IN " + list(arg);
          case "notIn": return k + " NOT IN " + list(arg);
          case "includes": return k + " INCLUDES " + value(arg);
          case "includesAny": return k + " INTERSECTS " + list(arg);
          default: bad("operator '" + ops[0] + "' on '" + k + "'");
        }
      });
      return paren(parts.join(" AND "), parts.length > 1 ? 2 : 4);
    };
    return walk(rule, 0);
  }

  function compile(text, attrDefs, ruleIds) {
    const src = String(text === undefined || text === null ? "" : text);
    const { rule, refs, sites } = parse(lex(src), src);
    const warnings = attrDefs ? typeCheck(sites, refs, attrDefs, ruleIds) : [];
    return { rule, refs, warnings };
  }

  VSM.expr = { compile, print, KEYWORDS };
  if (typeof module !== "undefined" && module.exports) module.exports = VSM.expr;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
