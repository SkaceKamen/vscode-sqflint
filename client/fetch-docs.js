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

function loadBlock(text, opening, closing, debug) {
	let bcount = -1;
	let index = 0;
	let result = '';
	while (index < text.length) {
		let chunk = 1;
		if (text.substr(index, opening.length) === opening) {
			bcount++;
			chunk = 2;
		}
		if (text.substr(index, closing.length) === closing) {
			bcount--;
			chunk = 2;

			if (bcount < 0) {
				break;
			}
		}
		result += text.substr(index, chunk);
		index += chunk;
	}
	return result;
}

function removeMoreTags(value) {
	if (!value)
		return value;

	return value
		.replace(/<br>/ig, '')
		.replace(/''\(since \[.*?\]\)''/ig, '')
		.replace(/''\(since \[.*?\]\)''/ig, '')
		.replace(/\(''since .*?''\)/ig, '')
		.replace(/''since [^']*''/ig, '')
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

function findVariables(wiki, debug) {
	let buffer = '';
	let index = 0;
	let part = 0;
	let inside = -1;
	let variables = {};

	let previousIdent = null;
	let variableName = '';
	let variableValue = '';

	let skip = false;

	while (index < wiki.length) {
		let chunk = 1;

		if (skip && (wiki.substr(index, 7) === '</code>' || wiki.substr(index, 9) === '</nowiki>')) {
			skip = false;
		}

		if (!skip) {
			if (wiki.substr(index, 6) === '<code>' || wiki.substr(index, 8) === '<nowiki>') {
				skip = true;
			}

			if (wiki.substr(index, 2) === '{{' || wiki.substr(index, 2) === '[[') {
				inside++;
				chunk = 2;
			} else if (wiki.substr(index, 2) === '}}' || wiki.substr(index, 2) === ']]') {
				inside--;
				if (inside < 0) inside = 0;
				chunk = 2;
			}

			if (wiki.substr(index, 1) === '|') {
				if (inside === 0) {
					if (part === 0) {
						variableValue = buffer
							.replace(/[rpx][0-9]+=/, '')
							.trim();
						part = 1;
						buffer = '';
					} else if (part === 1) {
						variableName = buffer
							.replace(/=/g, '')
							.replace(/(\n|\r)/g, '')
							.replace(/_{2,}/, '')
							.toLowerCase()
							.trim();

						if (variableName === "") {
							if (previousIdent === 'description') {
								variableName = "syntax";
							}
							if (previousIdent === 'game version' || (!variables['description'] && Object.keys(variables).length > 2)) {
								variableName = 'description';
							}
						}

						if (variableName.indexOf("syntax") === 0) {
							variableName = "syntax";
						}

						// Fix this
						if (variableName == "returnvalue" || variableName.indexOf('return value') === 0) {
							variableName = "return value";
						}

						if (variableName == "syntax" || variableName == "return value") {
							if (!variables[variableName])
								variables[variableName] = [];
							variables[variableName].push(parseValue(variableValue, variableName));
						} else {
							variables[variableName] = variableValue;
						}

						previousIdent = variableName;

						part = 0;
						buffer = '';
						variableName = null;
						variableValue = null;
					}
				}
			} else {
				buffer += wiki.substr(index, chunk);
			}
		} else {
			buffer += wiki.substr(index, chunk);
		}

		index += chunk;
	}

	return variables;
}

function parseDocument(doc, type, extended) {
	var document = new xmldoc.XmlDocument(doc);
	var pages = document.childrenNamed("page");
	var findCommand = /{{(?:Command|Function)\|(?:Comments)?=((?:.|\n)*?\n?)}}/i;

	var findVariable = /\|\s*((?:.|\n)*?)\s*\|\s*=[\r\t\f\v ]*(.*)/g;
	var findVariable2 = /\|\s*((?:.|\n)*?)\s*\|\s*[\r\t\f\v ]*([^=]*)=/g;

	var results = extended || {};
	var placeHolder = /\/\*\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*Returns:\s*([^]*)\s*\*\/\s*/i;
	var placeHolderWithExamples = /\/\*\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*Returns:\s*([^]*)\s*Examples:\s*([^]*)\s*\*\/\s*/i;
	var placeHolderArgument = /([0-9]+):\s*([^-]*)-\s*(.*)/g;
	var placeHolderSingularArgument = /_this:\s*([^-]*)-\s*(.*)/i;
	var placeHolderReturn = /\s*([^-]*)(.*)/;
	var sqfTypes = ["bool", "string", "object", "task", "array", "scalar", "number", "side", "group", "boolean", "code", "config", "control", "display", "namespace"];

	var noInfo = [];

	for (var i in pages) {
		var page = pages[i];

		if (parseInt(page.childNamed("ns").val) == 0) {
			var title = page.childNamed("title").val;
			var text = page.valueWithPath("revision.text");

			title = title.replace(/ /g, '_');

			var debug = false && title === 'random';

			var match = findCommand.exec(text);
			if (match) {
				var info;
				var start = text.indexOf('{{Command');
				if (start < 0) start = text.indexOf('{{Function');
				if (start < 0) throw new Error(title + ' has no start');
				var wiki = loadBlock(text.substr(start), '{{', '}}', debug);
				var variables = {};

				if (title === 'random') {
					wiki = wiki.replace("|p1= x: [[Number]]\n", "")
				}

				var signatures = [];
				var description = {
					plain: "",
					formatted: ""
				};
				var returns = [];
				var syntax = [];

				var previousIdent = null;

				variables = findVariables(wiki, debug);
				for (let ident in variables) {
					let value = variables[ident];
					let valueStr = JSON.stringify(value);

					debug && console.log('Variable:', '`' + ident + '`');
					debug && console.log('Value:', '`' + valueStr.substr(0, valueStr.length > 10 ? 10 : valueStr.length).replace(/\n/g, '<NL>') + '`');
				}

				debug && console.log(variables);

				if (variables["return value"])
					returns = variables["return value"];

				if (variables["syntax"])
					syntax = variables["syntax"];

				syntax = syntax.map((item) => {
					var commented = /<!--\s*(\[\]\s*call\s*[^;]+);\s*-->/i.exec(item);
					if (commented) {
						item = commented[1].trim();
					}
					return item.replace(/''/g, '');
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
						var dot = desc.search(/[^\.]\.[^\.]/);
						if (dot >= 0) {
							desc = desc.substr(0, dot + 2);
						}
					}

					description.plain = fixSyntax(desc).trim();
					description.formatted = desc.replace(/'''(.*?)'''/g, '**$1**')
						.replace(/<br>/ig, '')
						.replace(/\[\[(.*?)\|(.*?)\]\]/g, '[$1](https://community.bistudio.com/wiki/$2)')
						.replace(/\[\[(.*?)\]\]/g, '[$1](https://community.bistudio.com/wiki/$1)')
						.trim();
				}

				if (description.plain.length === 0 || description.formatted.length === 0) {
					noInfo.push(title);
				}

				// Add more info to description
				if (variables["game version"] && variables["game name"]) {
					description.formatted += " _(" + variables["game name"] + " " + variables["game version"] + ")_";
				}

				description.formatted += " *([more info](https://community.bistudio.com/wiki/" + title + "))*\r\n\r\n";

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
			} else {
				console.log("No match: " + title);
			}
		}
	}

	if (noInfo.length > 1) {
		console.log('No informations for ' + noInfo.length + ' commands/functions. Example: ' + noInfo[0]);
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
