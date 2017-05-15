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

Whitespace "whitespace"
  = [ \t]*

Code
  = NoNewline* "\r"? "\n"
  / NoNewline+ !.
  
NoNewline
  = [^\n\r]