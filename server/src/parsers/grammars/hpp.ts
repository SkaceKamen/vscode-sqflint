export interface Rule {
	name: string;
	symbols: any[];
	postprocess?: (d: any[], l?: number, r?: any) => void;
}
function id(x) {return x[0]; }
export let grammar: { ParserRules: Rule[], ParserStart: string } = {
    ParserRules: [
    {"name": "main$ebnf$1", "symbols": ["comment"], "postprocess": id},
    {"name": "main$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "main", "symbols": ["_", "ClassBody", "main$ebnf$1"], "postprocess": function(d) { return d[1] }},
    {"name": "IncludeDef$string$1", "symbols": [{"literal":"#"}, {"literal":"i"}, {"literal":"n"}, {"literal":"c"}, {"literal":"l"}, {"literal":"u"}, {"literal":"d"}, {"literal":"e"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "IncludeDef$ebnf$1", "symbols": ["whiteSpaceOnly"], "postprocess": id},
    {"name": "IncludeDef$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "IncludeDef", "symbols": ["IncludeDef$string$1", "__", "String", "IncludeDef$ebnf$1", {"literal":"\n"}], "postprocess": function(d, l) { return { 'include': d[2].string, 'location': d[2].location } }},
    {"name": "ArrayDef$string$1", "symbols": [{"literal":"["}, {"literal":"]"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "ArrayDef", "symbols": ["Name", "_", "ArrayDef$string$1", "_", {"literal":"="}, "_", {"literal":"{"}, "_", {"literal":"}"}, "_", {"literal":";"}], "postprocess": function(d) { return { 'variable': d[0] } }},
    {"name": "ArrayDef$string$2", "symbols": [{"literal":"["}, {"literal":"]"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "ArrayDef", "symbols": ["Name", "_", "ArrayDef$string$2", "_", {"literal":"="}, "_", {"literal":"{"}, "_", "ArrayValue", "_", {"literal":"}"}, "_", {"literal":";"}], "postprocess":  function(d) {
        	return {
        		'variable': d[0],
        		'value': d[8]
        	}
        } },
    {"name": "VariableDef", "symbols": ["Name", "_", {"literal":"="}, "_", "VariableValue", "_", {"literal":";"}], "postprocess":  function(d) {
        	return {
        		'variable': d[0],
        		'value': d[4]
        	}
        } },
    {"name": "ClassDef$string$1", "symbols": [{"literal":"c"}, {"literal":"l"}, {"literal":"a"}, {"literal":"s"}, {"literal":"s"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "ClassDef$ebnf$1", "symbols": [{"literal":";"}], "postprocess": id},
    {"name": "ClassDef$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "ClassDef", "symbols": ["ClassDef$string$1", "__", "ClassName", "_", "ClassBlock", "ClassDef$ebnf$1"], "postprocess":  function(d) {
        	return { 'class': d[2], 'block': d[4] };
        } },
    {"name": "ClassBlock", "symbols": [{"literal":"{"}, "_", "ClassBody", "_", {"literal":"}"}], "postprocess": function(d) { return d[2] }},
    {"name": "ClassBlock", "symbols": [{"literal":"{"}, "_", {"literal":"}"}], "postprocess": function(d) { return null }},
    {"name": "ClassName", "symbols": ["Name"], "postprocess": function(d) { return { 'name': d[0] } }},
    {"name": "ClassName", "symbols": ["Name", "_", {"literal":":"}, "_", "Name"], "postprocess": function(d) { return { 'name': d[0], 'extends': d[4] } }},
    {"name": "ClassBody", "symbols": ["Statement"], "postprocess": function(d) { return [d[0]] }},
    {"name": "ClassBody", "symbols": ["ClassBody", "_", "Statement"], "postprocess": function(d) { return d[0].concat([d[2]]); }},
    {"name": "Statement", "symbols": ["VariableDef"], "postprocess": id},
    {"name": "Statement", "symbols": ["ArrayDef"], "postprocess": id},
    {"name": "Statement", "symbols": ["ClassDef"], "postprocess": id},
    {"name": "Statement", "symbols": ["IncludeDef"], "postprocess": id},
    {"name": "VariableValue", "symbols": ["Number"], "postprocess": id},
    {"name": "VariableValue", "symbols": ["String"], "postprocess": function(d) { return d[0].string }},
    {"name": "VariableValue", "symbols": ["Name"], "postprocess": id},
    {"name": "ArrayValue", "symbols": ["VariableValue"], "postprocess": function(d) { return [d[0]] }},
    {"name": "ArrayValue", "symbols": ["ArrayValue", "_", {"literal":","}, "_", "VariableValue"], "postprocess": function(d) { return d[0].concat([d[4]]) }},
    {"name": "Name", "symbols": ["_name"], "postprocess": function(d) {return d[0]; }},
    {"name": "_name", "symbols": [/[a-zA-Z_]/], "postprocess": id},
    {"name": "_name", "symbols": ["_name", /[\w_]/], "postprocess": function(d) {return d[0] + d[1]; }},
    {"name": "Number", "symbols": ["_number"], "postprocess": function(d) {return parseFloat(d[0])}},
    {"name": "_posint", "symbols": [/[0-9]/], "postprocess": id},
    {"name": "_posint", "symbols": ["_posint", /[0-9]/], "postprocess": function(d) {return d[0] + d[1]}},
    {"name": "_int", "symbols": [{"literal":"-"}, "_posint"], "postprocess": function(d) {return d[0] + d[1]; }},
    {"name": "_int", "symbols": ["_posint"], "postprocess": id},
    {"name": "_float", "symbols": ["_int"], "postprocess": id},
    {"name": "_float", "symbols": ["_int", {"literal":"."}, "_posint"], "postprocess": function(d) {return d[0] + d[1] + d[2]; }},
    {"name": "_number", "symbols": ["_float"], "postprocess": id},
    {"name": "_number", "symbols": ["_float", {"literal":"e"}, "_int"], "postprocess": function(d){return d[0] + d[1] + d[2]; }},
    {"name": "String", "symbols": [{"literal":"\""}, "_string", {"literal":"\""}], "postprocess":  function(d, l) {
        	return {
        		string: d[1].string,
        		location: [
        			Math.min(d[1].location[0], l),
        			Math.max(d[1].location[1], l) + 1
        		]
        	}
        } },
    {"name": "_string", "symbols": [], "postprocess": function(d, l) { return { string: "", location: [l, l] } }},
    {"name": "_string", "symbols": ["_string", "_stringchar"], "postprocess":  function(d) {
        	return {
        		string: d[0].string + d[1].string,
        		location: [
        			Math.min(d[0].location[0], d[1].location[0]),
        			Math.max(d[0].location[1], d[1].location[1])
        		]
        	}
        } },
    {"name": "_stringchar", "symbols": [/[^\\"]/], "postprocess": function(d, l) { return { string: d[0], location: [l, l + 1] } }},
    {"name": "_stringchar", "symbols": [{"literal":"\\"}, /[^]/], "postprocess":  function(d, l) {
        	return {
        		string: d[0] + d[1],
        		location: [l, l + 2]
        	}
        } },
    {"name": "_", "symbols": []},
    {"name": "_", "symbols": ["__"]},
    {"name": "__", "symbols": ["whiteSpaceOnly"]},
    {"name": "__", "symbols": ["newline"]},
    {"name": "__", "symbols": ["whiteSpaceOnly", "__"]},
    {"name": "__", "symbols": ["newline", "__"]},
    {"name": "whiteSpaceOnly", "symbols": [/[\f\r\t\v\u00A0\u2028\u2029 ]/]},
    {"name": "newline$ebnf$1", "symbols": ["comment"], "postprocess": id},
    {"name": "newline$ebnf$1", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "newline", "symbols": ["newline$ebnf$1", {"literal":"\n"}]},
    {"name": "comment$string$1", "symbols": [{"literal":"/"}, {"literal":"/"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "comment$ebnf$1", "symbols": []},
    {"name": "comment$ebnf$1", "symbols": [/[^\n]/, "comment$ebnf$1"], "postprocess": function arrconcat(d) {return [d[0]].concat(d[1]);}},
    {"name": "comment", "symbols": ["comment$string$1", "comment$ebnf$1"]},
    {"name": "comment$string$2", "symbols": [{"literal":"/"}, {"literal":"*"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "comment$ebnf$2", "symbols": []},
    {"name": "comment$ebnf$2", "symbols": ["commentchars", "comment$ebnf$2"], "postprocess": function arrconcat(d) {return [d[0]].concat(d[1]);}},
    {"name": "comment$ebnf$3", "symbols": [/[^]/], "postprocess": id},
    {"name": "comment$ebnf$3", "symbols": [], "postprocess": function(d) {return null;}},
    {"name": "comment$string$3", "symbols": [{"literal":"*"}, {"literal":"/"}], "postprocess": function joiner(d) {return d.join('');}},
    {"name": "comment", "symbols": ["comment$string$2", "comment$ebnf$2", "comment$ebnf$3", "comment$string$3"]},
    {"name": "commentchars", "symbols": [{"literal":"*"}, /[^\/]/]},
    {"name": "commentchars", "symbols": [/[^*]/, /[^]/]}
]
  , ParserStart: "main"
}
 