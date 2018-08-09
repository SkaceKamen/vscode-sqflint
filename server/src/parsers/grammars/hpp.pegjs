Start
  = __ program:ClassBody __ { return program }

// Separator, Space
Zs = [\u0020\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]

ClassBody
  = body:ClassStatements? {
  	var wrapper = { "variables": {}, "classes": {} }
    if (body) {
      for (var i in body) {
        var item = body[i]
        if (item.class) {
          wrapper.classes[item.class.name.toLowerCase()] = item.class
        }
        if (item.variable) {
          wrapper.variables[item.variable.toLowerCase()] = item.value
        }
      }
    }
    return wrapper
  }

ClassStatements
  = head:ClassStatement tail:(__ stat:ClassStatement { return stat })* {
  	return [head].concat(tail)
  }

ClassStatement
  = dec:VariableDeclaration { return dec }
  / dec:ClassDeclaration { return dec }

ClassDeclaration
  = "class" __ name:Identifier
    extend:(__ ":" __ id:Identifier {return id})? __
    body: ("{" __ body:ClassBody? __ "}" {return body})? EOS? {
    	return {
        	"class": {
            	"name": name,
              "extends": extend,
              "body": body || { "variables": {}, "classes": {} },
              "location": location()
            }
        }
    }

VariableDeclaration
  = ArrayDeclaration
  / NormalDeclaration

NormalDeclaration
  = name:Identifier __ "=" __ value:VariableValue EOS {
  	return {
    	"variable": name,
        "value": value
     }
  }

VariableValue
  = num:NumericalExpression { return num }
  / macro:MacroValue { return macro }
  / str:StringLiteral { return str }
  / trans:TranslationIdentifier { return trans }

MacroValue
  = macro:Identifier __ "(" __ params:MacroParams __ ")" {
    return "MACRO{" + macro + "("+ params + ")" + "}"
  }

MacroParams
  = head:VariableValue tail:(__ "," __ val:VariableValue {return val})* {
    if(tail.length)
	    return head + "," + tail.join(",")
    return head
  }

ArrayVariableValue
  = VariableValue
  / arr:ArrayValues { return arr }

NumericalExpression "numerical formula"
  = head:NumericalValue tail:(__ operator:ExpressionOperator __ value:NumericalValue { return operator + value })* {
    if (tail)
    	return head + tail.join("")
    return head;
   }

ExpressionOperator
  = [\*\/\|&+-]
  / "min"
  / "max"
  / "abs"
  / "interpolate"
  / "factor"

NumericalValue "number"
  = "(" __ exp:NumericalExpression __ ")" { return "(" + exp + ")" }
  / prefix:"0x" value:[0-9A-Fa-f]+ { return prefix + value.join("") }
  / prefix:[+-]? vals:Digit+ tail:("." suffix:Digit*)? supertail:("e" NumericalValue)? { return vals.join("") }
  / MacroValue
  / Identifier

ArrayDeclaration
  = name:Identifier __ "[]" __ "=" __ value:ArrayValues EOS {
    return {
    	"variable": name,
        "value": value
     }
  }

ArrayValues
  = "{" __ vals:ArrayValue __ "}" { return vals }
  / "{" __ "}" { return [] }
  / macro:Identifier { return { "macro": macro } }

ArrayValue
  = head:ArrayVariableValue tail:(__ "," __ val:ArrayVariableValue {return val})* ","? {
    return [head].concat(tail)
  }

Identifier "identifier"
  = head:IdentifierStart tail:IdentifierPart* {
  	return head + tail.join("");
  }

IdentifierStart
  = [A-Za-z_]

IdentifierPart
  = IdentifierStart
  / Digit

TranslationIdentifier
  = "$" ident:Identifier { return "$" + ident }

Digit "digit"
  = [0-9]

__
  = (WhiteSpace / LineTerminatorSequence / Comment)*

_
  = (WhiteSpace / MultiLineCommentNoLineTerminator)*

EOS
  = __ ";"
  / _ SingleLineComment? LineTerminatorSequence
  / _ &"}"
  / __ EOF

EOF
  = !.

SourceCharacter
  = .

WhiteSpace "whitespace"
  = "\t"
  / "\v"
  / "\f"
  / " "
  / "\u00A0"
  / "\uFEFF"
  / Zs

LineTerminator
  = [\n\r\u2028\u2029]

LineTerminatorSequence "end of line"
  = "\n"
  / "\r\n"
  / "\r"
  / "\u2028"
  / "\u2029"

Comment "comment"
  = MultiLineComment
  / SingleLineComment

MultiLineComment
  = "/*" (!"*/" SourceCharacter)* "*/"

MultiLineCommentNoLineTerminator
  = "/*" (!("*/" / LineTerminator) SourceCharacter)* "*/"

SingleLineComment
  = "//" (!LineTerminator SourceCharacter)*

StringLiteral "string"
  = '"' chars:DoubleStringCharacter* '"' { return chars.join("") }

DoubleStringCharacter
  = "\"" "\""
  / !('"' / LineTerminator) SourceCharacter { return text() }
  / LineContinuation

LineContinuation
  = "\\" LineTerminatorSequence { return ""; }