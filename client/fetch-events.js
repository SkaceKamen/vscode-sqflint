"use strict"
let fs = require('fs');
let https = require('https');
let sources = {
	units: {
		url: "https://community.bistudio.com/wiki/Arma_3:_Event_Handlers",
		cache: "cache/events-units.html"
	},
	ui: {
		url: "https://community.bistudio.com/wiki/User_Interface_Event_Handlers",
		cache: "cache/events-ui.html"
	}
};

let jsdom = require("jsdom").jsdom;
let events = {};

fs.mkdirSync('cache', { recursive: true })

for(let type in sources) {
	let source = sources[type];
	if (!fs.existsSync(source.cache)) {
		let file = fs.createWriteStream(source.cache);
		let request = https.get(source.url, (res) => {
			res.pipe(file);
			res.on('end', () => parseEvents(source.cache, type));
		});
	} else {
		parseEvents(source.cache, type);
	}
}

function parseEvents(file_path, type) {
	fs.readFile(file_path, (err, data) => {
		if (err) throw err;

		let doc = jsdom(data, {
			features: { FetchExternalResources: false }
		});

		let tables = doc.getElementsByClassName("wikitable");
		if (tables.length == 0) tables = doc.getElementsByClassName("bikitable");

		for(let e in tables) {
			let table = tables[e];
			for(let c in table.children) {
				let child = table.children[c];
				for(let c2 in child.children) {
					let child2 = child.children[c2];
					if (child2.tagName && child2.tagName.toLowerCase() == "tr") {
						parseRow(child2, type);
					}
				}
			}
		}

		fs.writeFile("server/definitions/events.json", JSON.stringify(events));
	});
}

function parseRow(row, type) {
	let tds = row.getElementsByTagName('td');

	if (type == "units") {
		if (tds.length >= 3) {
			let id = null;
			let title = tds[0];
			let desc = convertHTML(tds[1]);
			let args = convertHTML(tds[2]);

			title = title.getElementsByTagName('span')[0];
			id = title.id;
			title = title.innerHTML;

			events[title.toLowerCase()] = {
				id: id,
				title: title,
				description: desc,
				args: args,
				type: type
			};
		}
	} else if (type == "ui") {
		if (tds.length >= 5) {
			let priority = convertHTML(tds[0]);
			let title = convertHTML(tds[1]).replace("on", "");
			let desc = convertHTML(tds[2]);
			let args = convertHTML(tds[3]);
			let scope = convertHTML(tds[4]);

			events[title.toLowerCase()] = {
				id: title.toLowerCase(),
				title: title,
				description: desc,
				args: args,
				scope: scope,
				type: type,
				priority: priority
			};
		}
	}
}

function convertHTML(el) {
	let result = "";

	for(let c in el.childNodes) {
		let child = el.childNodes[c];

		if (child.nodeType == 3) {
			result += child.textContent;
		} else if (child.nodeType == 1) {
			let tag = child.tagName.toLowerCase();

			if (tag == "a") {
				result += "[" + child.innerHTML + "](" + child.href + ")";
			}

			if (tag == "li") {
				result += "* " + convertHTML(child);
			}

			if (tag == "ul" || tag == "p") {
				result += "\n" + convertHTML(child) + "\n";
			}
		}
	}

	return result.trim();
}