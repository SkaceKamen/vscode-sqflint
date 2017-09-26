/**
 * This script is used to convert wikimedia dump of official wiki
 * to JSON format used in this extension.
 *
 * To get create xml files used by this file, you need to go to /Special:Export/,
 * select Functions or Commands category, then save them as functionsExport.xml and
 * operatorsExport.xml.
 *
 */

var fs = require('fs');
var xmldoc = require('xmldoc');

function fixSyntax(syntax) {
	syntax = removeMoreTags(syntax);

	var eq = syntax.indexOf('=');
	if (eq >= 0) {
		syntax = syntax.substr(eq + 1).trim();
	}

	return syntax.trim();
}

function parseValue(value, type) {
	if (type == "syntax") {
		return fixSyntax(value);
	}
	if (type == "return value") {
		var ret = value.trim();
		var dash = ret.indexOf("-");
		if (dash >= 0) {
			ret = ret.substr(0, dash - 1).trim();
		}
		return ret;
	}
}

function removeMoreTags(value) {
	if (!value)
		return value;

	return value
		.replace(/<br>/ig, '')
		.replace(/''since [^']*''/ig, '')
		.replace(/''\(since \[.*?\]\)''/ig, '')
		.replace(/\(''since .*?''\)/ig, '')
		.replace(/<nowiki>(.*?)<\/nowiki>/g, '$1')
		.replace(/'''(.*?)'''/g, '$1')
		.replace(/\[\[(.*?)\|(.*?)\]\]/g, '$2')
		.replace(/\[\[(.*?)\]\]/g, '$1')
		.replace(/ {2,}/g, ' ')
		.replace(/&nbsp;/g, '');
}

function polishSyntaxArgument(item) {
	if (item.desc.length < 10) {
		return item.desc;
	}
	if (item.type.length > 10) {
		return item.type.substr(0, 8) + "..";
	}
	return item.type;
}

function parseDocument(doc, type, extended) {
	var document = new xmldoc.XmlDocument(doc);
	var pages = document.childrenNamed("page");
	var findCommand = /{{(?:Command|Function)\|=((?:.|\n)*?\n)}}/i;
	var findVariable = /\|\s*((?:.|\n)*?)\s*\|\s*=[\r\t\f\v ]*(.*)/g;
	var results = extended || {};
	var placeHolder = /\/\*\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*Returns:\s*([^]*)\s*\*\/\s*/i;
	var placeHolderWithExamples = /\/\*\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*Returns:\s*([^]*)\s*Examples:\s*([^]*)\s*\*\/\s*/i;
	var placeHolderArgument = /([0-9]+):\s*([^-]*)-\s*(.*)/g;
	var placeHolderSingularArgument = /_this:\s*([^-]*)-\s*(.*)/i;
	var placeHolderReturn = /\s*([^-]*)(.*)/;
	var sqfTypes = ["bool", "string", "object", "task", "array", "scalar", "number", "side", "group", "boolean", "code", "config", "control", "display", "namespace"];

	for(var i in pages) {
		var page = pages[i];

		if (parseInt(page.childNamed("ns").val) == 0) {
			var title = page.childNamed("title").val;
			var text = page.valueWithPath("revision.text");

			title = title.replace(/ /g, '_');

			var match = findCommand.exec(text);
			if (match) {
				var info;
				var wiki = match[1];
				var variables = {};

				var signatures = [];
				var description = {
					plain: "",
					formatted: ""
				};
				var returns = [];
				var syntax = [];

				var previousIdent = null;

				while (match = findVariable.exec(wiki)) {
					var ident = match[2].toLowerCase().trim();
					var value = match[1];

					value = value.replace(/[srp][0-9]*=/ig, '');

					// Empty nothing after description means syntax apparently
					if (ident == "" && previousIdent == 'description') {
						ident = "syntax";
					}

					if (ident.indexOf("syntax") == 0) {
						ident = "syntax";
					}

					// Fix this
					if (ident == "returnvalue") {
						ident = "return value";
					}

					if (ident == "syntax" || ident == "return value") {
						if (!variables[ident])
							variables[ident] = [];
						variables[ident].push(parseValue(value, ident));
					} else {
						variables[ident] = value;
					}

					previousIdent = ident;
				}

				if (variables["return value"])
					returns = variables["return value"];

				if (variables["syntax"])
					syntax = variables["syntax"];

				syntax = syntax.map((item) => {
					var commented = /<!--\s*(\[\]\s*call\s*[^;]+);\s*-->/i.exec(item);
					if (commented) {
						item = commented[1].trim();
					}
					return item;
				});

				// Parse description
				if (variables["description"]) {
					var desc = variables["description"];
					match = placeHolderWithExamples.exec(desc);
					if (!match) {
						match = placeHolder.exec(desc);
					}

					if (match) {
						desc = match[1];

						if (match[2].trim()) {
							var args = [];
							var amatch = null;
							while (amatch = placeHolderArgument.exec(match[2])) {
								args.push({
									type: amatch[2].trim().replace(/(\s+)or(\s+)/g, "/"),
									desc: amatch[3].trim()
								});
							}

							if (args.length > 0) {
								syntax = ["[" + args.map((item) => polishSyntaxArgument(item)).join(", ") + "] call " + title];

								desc += "\r\nArguments:\r\n";
								args.forEach((arg, index) => {
									// desc += "\r\n - " + (index + 1) + ": " + arg.type + " - " + arg.desc
									desc += "\r\n " + index + ". " + arg.type + " - " + arg.desc;
								});
							} else {
								amatch = placeHolderSingularArgument.exec(match[2]);
								if (amatch) {
									var arg = { type: amatch[1].trim(), desc: amatch[2].trim() };
									syntax = [polishSyntaxArgument(arg) + " call " + title];
									desc += "\r\nArgument: _this: " + arg.type + " - " + arg.desc;
								}
							}
						}

						if (match[3].trim()) {
							match[3] = match[3].trim();
							var rmatch = placeHolderReturn.exec(match[3]);
							if (rmatch) {
								returns = [rmatch[1]];
								desc += "\r\n\r\nReturns: " + match[3];
							} else if (sqfTypes.indexOf(match[3].toLowerCase()) != -1) {
								returns = [match[3]];
							} else {
								returns = ["ANY"];
								desc += "\r\n\r\nReturns: " + match[3];
							}
						}
					} else {
						// Remove image tags
						desc = desc.replace(/\[\[Image(.*?)\]\]/g, '');

						// Only use first sentence
						var dot = desc.indexOf(".");
						if (dot >= 0) {
							desc = desc.substr(0, dot + 1);
						}
					}

					description.plain = fixSyntax(desc).trim();
					description.formatted = desc.replace(/'''(.*?)'''/g, '**$1**')
						.replace(/<br>/ig, '')
						.replace(/\[\[(.*?)\|(.*?)\]\]/g, '[$1](https://community.bistudio.com/wiki/$2)')
						.replace(/\[\[(.*?)\]\]/g, '[$1](https://community.bistudio.com/wiki/$1)')
						.trim();
				}

				// Add more info to description
				if (variables["game version"] && variables["game name"]) {
					description.formatted += " _(" + variables["game name"] + " " + variables["game version"] + ")_";
				}

				description.formatted += " _([more info](https://community.bistudio.com/wiki/" + title + "))_\r\n\r\n";

				// Add signatures
				if (syntax.length > 0) {
					for(var s in syntax) {
						var signature = syntax[s].trim();
						var ret = returns[s];
						if (ret != null) ret = ret.trim();

						signatures.push({
							signature: removeMoreTags(signature),
							returns: removeMoreTags(ret || null)
						});
					}
				} else {
					signatures.push({
						signature: title
					});
				}

				results[title.toLowerCase()] = {
					type: type,
					title: title,
					description: description,
					signatures: signatures
				}
			}
		}
	}

	return results;
}

fs.readFile(__dirname + '/server/operatorsExport.xml', (err, data) => {
	if (err) throw err;

	var docs = parseDocument(data.toString(), "command");
	fs.readFile(__dirname + '/server/functionsExport.xml', (err, data) => {
		if (err) throw err;

		docs = parseDocument(data.toString(), "function", docs);
		fs.readFile(__dirname + '/../cba/cba.json', (err, data) => {
			if (err) throw err;

			var items = JSON.parse(data);
			for(var ident in items) {
				docs[ident] = items[ident];
			}

			fs.writeFile(__dirname + '/server/definitions/documentation.json', JSON.stringify(docs));
		});
	});
});
