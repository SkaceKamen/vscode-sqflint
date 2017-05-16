"use strict"
const fs = require('fs');
const path = require('path');
const jsdom = require("jsdom").jsdom;
const https = require('https');

const url = "https://community.bistudio.com/wiki/Description.ext";
const cache = "cache/description.html";

if (!fs.existsSync(cache)) {
	let file = fs.createWriteStream(cache);
	let request = https.get(url, (res) => {
		res.pipe(file);
		res.on('end', () => parseDescription(cache));
	});
} else {
	parseDescription(cache);	
};

function clearText(text) {
	return text.replace(/[\r\n]/g, "").replace(/<\s*br\s*\/\s*>/, "\n");
}

function parseDescription(filepath) {
	let data = { properties: [] };
	let values = data.properties;
	
	let contents = fs.readFileSync(filepath).toString();
	let doc = jsdom(contents, {
		features: { FetchExternalResources: false }
	});

	let tables = doc.getElementsByClassName('bikitable');
	if (tables.length != 1) {
		throw new Error("Failed to find correct .bikitable. Found: " + tables.length + " tables");
	}

	let table = tables[0];
	let rows = table.children[0].children;

	for (var i = 0; i < rows.length; i++) {
		if (i == 0) continue;

		let row = rows[i];
		let name = clearText(row.children[1].textContent);
		let type = clearText(row.children[2].textContent).toLowerCase();
		let description = clearText(row.children[3].childNodes[0].textContent);
		let link = url + "#" + name;

		values.push({
			name, type, description, link
		});
	}

	fs.writeFileSync("server/definitions/description-values.json", JSON.stringify(data));
}