"use strict"

/**
 * This script extracts CBA documentation from CBA sqf files.
 * You will need to clone CBA repo to CBA_A3 folder.
 */

let fs = require('fs');
let fs_path = require('path');

let documentation = {};

let fncRe = /\/\*[\s-]*Function:\s([a-zA-Z_0-9]*)\s*Description:\s*(.*)\s*([^\*]*)/igm;

function parseContents(contents) {
	let match;
	
	// console.log("Trying to match", contents.length)
	
	while (match = fncRe.exec(contents)) {
		// console.log(match);
		
		let title = match[1];
		let desc = match[2];
		let details = match[3];

		let examples = false;

		details = details.split("\n").map((item) => {
			if (item.length < 2) return item;
			
			if (!examples) {
				if (/\s/.test(item.substr(0))) {
					item = " - " + item.trim();
				} else {
					item = "\n**" + item + "**\n";
				}

				if (/-{2,}/.test(item)) {
					item = "";
				}
			} else {
				item = item.trim();
			}

			if (item.toLowerCase().indexOf("(begin example)") >= 0) {
				examples = true;
				item = "```sqf";
			}
			if (item.toLowerCase().indexOf("(end)") >= 0) {
				if (examples) item = "```";
				examples = false;
			}


			return item;
		}).join("\n");

		/*
		details = ["## Parameters"];
		params.split("\n").forEach((param) => {
			details.push(" * " + param.trim());
		});

		details.push("## Returns");
		details.push(returns);

		details.push("## Example");
		details.push("```sqf");
		details.push(example);
		details.push("```");
		details = details.join("\r\n");
		*/

		documentation[title.toLowerCase()] = {
			type: "function",
			title: title,
			description: {
				plain: desc,
				//formatted: desc + "\r\n#Parameters:\r\n * Something - somethigh\r\n * Another something"
				formatted: desc + "\r\n\r\n" + details
			},
			signatures: []
		};
	}

	// console.log("done matchi", contents.length);
}

/**
 * Tries to parse all sqf files in workspace.
 */
function loadFiles() {
	walkPath(__dirname + "/CBA_A3/addons/", (file) => {
		fs.readFile(file, (err, data) => {
			if (err) throw err;

			// console.log("Loaded file", file);
			if (data) {
				parseContents(data.toString());
				// console.log("Loaded file contents");
				saveDocs();
			}
		});
	});
}

function saveDocs() {
	fs.writeFile(__dirname + "/cba.json", JSON.stringify(documentation), (err) => {
		if (err) throw err;
		// console.log("Saved!");
	});
}

/**
 * Walks specified path while calling callback for each sqf file found.
 */
function walkPath(path, callback) {
	// console.log("Walking", path);
	
	try {
		fs.readdir(path, (err, files) => {
			if (err) throw err;

			// console.log("Loaded", files.length, "files");

			files.forEach((file) => {
				if (file) {
					file = fs_path.join(path, file);

					// console.log("Requiring stat on "+ file);
					fs.stat(file, (err, stat) => {
						if (err) throw err;
						
						// console.log("Done stat on", file);
						if (stat) {
							if (stat.isDirectory()) {
								walkPath(file, callback);
							} else if (fs_path.extname(file).toLowerCase() == ".sqf") {
								callback(file);
							}
						}
					});
				}
			});
		});
	} finally {

	}
}


loadFiles();