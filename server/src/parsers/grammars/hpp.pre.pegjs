Start
  = program:Lines { return program }
  
Lines
  = head:Line tail:(Line)* {
    var items = [head].concat(tail)
    var actual = []
    for (var i in items) {
      if (items[i]) { actual.push(items[i]); }
    }
    return actual
  }
  
Line
  = Define
  / Include
  / EvalExec
  / Code { return null; }

Define
  = Whitespace "#define" value:NoNewline* {
    return { "define": value.join(""), "location": location() };
  }
  
Include
  = Whitespace "#include" Whitespace value:IncludeValue {
    return { "include": value.join(""), "location": location() };
  }
  
IncludeValue
  = Whitespace "\"" value:[^\n\r\"]* "\""  { return value }
  / Whitespace "<" value:[^\n\r>]* ">" { return value }

EvalExec
  = NoNewline* loc:EvalOrExec {
    return loc;
  }

EvalOrExec
  = "__EVAL" value:NoNewline* { return { eval: value.join(""), location: location() } }
  / "__EXEC" value:NoNewline* { return { eval: value.join(""), location: location() } }

Whitespace "whitespace"
  = [ \t]*

Code
  = NoNewline* "\r"? "\n"
  / NoNewline+ !.
  
NoNewline
  = !NoCode v:("\\" "\r"? "\n" / [^\r\n]) { return typeof v === "string" ? v : v.join("") }
  
NoCode
 = "__EVAL"
 / "__EXEC"
