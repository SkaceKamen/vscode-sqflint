"use strict";
import fs from 'fs';
import { JSDOM } from 'jsdom';
import https from 'https';
import { dirname, join } from 'path';

const url = "https://community.bistudio.com/wiki/Description.ext";
const cache = "cache/description.html";

fs.mkdirSync(dirname(cache), { recursive: true });

function parseDescription(filepath: string) {
    const data = { properties: [] };
    const values = data.properties;

    const contents = fs.readFileSync(filepath).toString();
    const doc = new JSDOM(contents);

    (Array.from(doc.window.document.querySelectorAll('.mw-headline')) as HTMLElement[])
        .slice(1)
        .filter(i => i.parentElement.tagName !== 'H2')
        .forEach(i => {
            const name = i.textContent;
            const descElement = (i.parentElement.parentElement.nextElementSibling || i.parentElement.nextElementSibling) as HTMLElement;
            const description = descElement ? descElement.textContent : '';
            const link = url + "#" + name;

            values.push({ name, description, link });
        });

    fs.writeFileSync(join(__dirname, "../definitions/description-values.json"), JSON.stringify(data));
}

if (!fs.existsSync(cache)) {
    const file = fs.createWriteStream(cache);
    https.get(url, (res) => {
        res.pipe(file);
        res.on('end', () => parseDescription(cache));
    });
} else {
    parseDescription(cache);
}
