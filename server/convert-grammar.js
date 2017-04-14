var fs = require('fs');

fs.readFile(process.argv[2], function(err, data) {
	if (err) throw err;

	data = data.toString().replace([
		"// Generated automatically by nearley",
		"// http://github.com/Hardmath123/nearley",
		"(function () {",
		"function id(x) {return x[0]; }",
		"var grammar = {"
	].join("\n"), [
		"export interface Rule {",
		"	name: string;",
		"	symbols: any[];",
		"	postprocess?: (d: any[], l?: number, r?: any) => void;",
		"}",
		"function id(x) {return x[0]; }",
		"export let grammar: { ParserRules: Rule[], ParserStart: string } = {"
	].join("\n"));

	data = data.replace([
		"if (typeof module !== 'undefined'&& typeof module.exports !== 'undefined') {",
		"   module.exports = grammar;",
		"} else {",
		"   window.grammar = grammar;",
		"}",
		"})();"
	].join("\n"), "");
	
	console.log(data);
});