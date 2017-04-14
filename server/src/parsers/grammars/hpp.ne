main -> _ ClassBody _ comment:? {% function(d) { return d[1] } %}

IncludeDef -> "#include" __ String [^\n]:* "\n" {% function(d, l) { return { 'include': d[2].string, 'location': d[2].location } } %}
DefineDef -> "#define" __ Name __ [^\n]:* "\n" {% function(d, l) { return { 'define': d[2], 'value': d[4] } } %}

ArrayDef -> Name _ "[]" _ "=" _ "{" _ "}"  _ ";" {% function(d) { return { 'variable': d[0] } } %}
	| Name _ "[]" _ "=" _ "{" _ ArrayValue _ "}"  _ ";" {% function(d) {
		return {
			'variable': d[0],
			'value': d[8]
		}
	} %}

VariableDef -> Name _ "=" _ VariableValue _ ";" {% function(d) {
	return {
		'variable': d[0],
		'value': d[4]
	}
} %}

ClassDef -> "class" __ ClassName _ ClassBlock ";":? {% function(d) {
	return { 'class': d[2], 'block': d[4] };
} %}

ClassBlock -> "{" _ ClassBody _ "}" {% function(d) { return d[2] } %}
	| "{" _ "}" {% function(d) { return null } %}

ClassName -> Name {% function(d) { return { 'name': d[0] } } %}
	| Name _ ":" _ Name {% function(d) { return { 'name': d[0], 'extends': d[4] } } %}

ClassBody -> Statement {% function(d) { return [d[0]] } %}
	| ClassBody _ Statement {% function(d) { return d[0].concat([d[2]]) } %}

Statement -> VariableDef {% id %}
	| ArrayDef {% id %}
	| ClassDef {% id %}
	| IncludeDef {% id %}
	| DefineDef {% id %}

VariableValue -> Number {% id %}
	| String {% function(d) { return d[0].string } %}

ArrayValue -> VariableValue {% function(d) { return [d[0]] } %}
	| ArrayValue _ "," _ VariableValue {% function(d) { return d[0].concat([d[4]]) } %}

# Name

Name -> _name {% function(d) {return d[0]; } %}
 
_name -> [a-zA-Z_] {% id %}
	| _name [\w_] {% function(d) {return d[0] + d[1]; } %}

# Numbers
 
Number -> _number {% function(d) { return d[0] } %}
	| Name {% function(d) { return d[0] } %}
	| "(" _ Number _ ")" {% function(d) { return "(" + d[2] + ")" } %}
	| Number _ [+\-/%*] _ Number {% function(d) { return d[0] + d[2] + d[4] } %}

_posint ->
	[0-9] {% id %}
	| _posint [0-9] {% function(d) {return d[0] + d[1]} %}
 
_int ->
	"-" _posint {% function(d) {return d[0] + d[1]; }%}
	| _posint {% id %}
 
_float ->
	_int {% id %}
	| _int:? "." _posint {% function(d) {return (d[0] || '') + d[1] + d[2]; }%}
 
_number ->
	_float {% id %}
	| _float "e" _int {% function(d){return d[0] + d[1] + d[2]; } %}
	| "0x" _int {% function(d) { return d[0] + d[1]; } %}
 
#Strings
 
String -> "\"" _string "\"" {% function(d, l) {
	return {
		string: d[1].string,
		location: [
			Math.min(d[1].location[0], l),
			Math.max(d[1].location[1], l) + 1
		]
	}
} %}
 
_string ->
	null {% function(d, l) { return { string: "", location: [l, l] } } %}
	| _string _stringchar {% function(d) {
		return {
			string: d[0].string + d[1].string,
			location: [
				Math.min(d[0].location[0], d[1].location[0]),
				Math.max(d[0].location[1], d[1].location[1])
			]
		}
	} %}
 
_stringchar ->
	[^\\"] {% function(d, l) { return { string: d[0], location: [l, l + 1] } } %}
	| "\"\"" {% function(d, l) { return { string: d[0], location: [l, l + 2] } } %}
	| "\\" [^] {% function(d, l) {
		return {
			string: d[0] + d[1],
			location: [l, l + 2]
		}
	} %}
 
# Whitespace
_ -> null
	| __

__ -> whiteSpaceOnly
    | newline 
    | whiteSpaceOnly __ 
    | newline __ 

whiteSpaceOnly -> [\f\r\t\v\u00A0\u2028\u2029 ]

newline -> comment:? "\n"

comment -> "//" [^\n]:*
	| "/*" commentchars:* [^]:? "*/"

commentchars -> "*" [^/] 
	| [^*] [^]