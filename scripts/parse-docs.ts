/**
 * This script is used to convert wikimedia dump of official wiki
 * to JSON format used in this extension.
 *
 * To get create xml files used by this file, you should run fetch-docs.ts, or
 * if this scripts fails, you need to go to /Special:Export/,
 * select Functions or Commands category, then save them as functionsExport.xml and
 * operatorsExport.xml.
 */

import fs from 'fs'
import { parseDocument } from './docs/parser';

fs.readFile(__dirname + '/../definitions/operatorsExport.xml', (err, data) => {
    if (err) throw err;

    let docs = parseDocument(data.toString(), "command", {});
    fs.readFile(__dirname + '/../definitions/functionsExport.xml', (err, data) => {
        if (err) throw err;

        docs = parseDocument(data.toString(), "function", docs);
        fs.readFile(__dirname + '/../cba/cba.json', (err, data) => {
            if (err) throw err;

            const items = JSON.parse(data.toString());
            for(const ident in items) {
                docs[ident] = items[ident];
            }

            fs.readFile(__dirname + '/../ace3/ace3.json', (err, data) => {
                if (err) throw err;

                const items = JSON.parse(data.toString());
                for(const ident in items) {
                    docs[ident] = items[ident];
                }

                fs.writeFileSync(__dirname + '/../definitions/documentation.json', JSON.stringify(docs));
            });
        });
    });
});
