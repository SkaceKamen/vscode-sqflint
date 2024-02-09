/**
 * This script extracts CBA documentation from CBA sqf files.
 * You will need to clone CBA repo to CBA_A3 folder.
 */

import fs from "fs";
import fsPath from "path";
import { WikiDocumentation } from '../server/src/server';

const documentation: Record<string, WikiDocumentation> = {};

const DOCSTRING_RE = /\/\*([\s\S]*?)\*\//;
const ITEM_DESC_RE = /^(\w+):/;
const PARAM_DESC_RE = /^\s*(?:[0-9]+:\s*)([_\w]+)\s*-\s*(.*)\s+<(.*)>$/;
const RETURNS_DESC_RE1 = /^\s*([_\w]+)\s*-\s*(.*)\s+<(.*)>$/;
const RETURNS_DESC_RE2 = /^\s*([_\w]+)\s*-\s*(.*)$/;
const FUNCTION_NAME_RE = /^Function:\s*([\w_]+)$/;

const parseDocstring = (docstring: string) => {
    const lines = docstring.split('\n');
    let description = undefined as string | undefined;
    const params = [] as {
        name: string;
        type: string;
        desc: string;
    }[];
    let returns = undefined as { type?: string; name?: string; desc?: string } | undefined;
    let title = undefined as string | undefined;

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const match = ITEM_DESC_RE.exec(line);

        if (match) {
            i++;

            const type = match[1];

            switch (type) {
            case 'Function': {
                const match= FUNCTION_NAME_RE.exec(line);
                if (match) {
                    title = match[1];
                }

                break;
            }
            case 'Description': {
                const desc = [] as string[];
                while (i < lines.length) {
                    const line = lines[i];
                    if (ITEM_DESC_RE.test(line)) {
                        break;
                    } else {
                        desc.push(line);
                        i++;
                    }
                }
                description = desc.join('\n');
                break;
            }
            case 'Parameters': {
                while (i < lines.length) {
                    i++;
                    const line = lines[i];
                    if (ITEM_DESC_RE.test(line)) {
                        break;
                    } else {
                        const paramMatch = PARAM_DESC_RE.exec(line);
                        if (paramMatch) {
                            const [, name, desc, type] = paramMatch;
                            params.push({
                                name,
                                type: type[0].toUpperCase() + type.slice(1).toLowerCase(),
                                desc
                            });
                        }
                    }
                }
                break;
            }
            case 'Returns': {
                const returnItems = [] as { type?: string; name?: string; desc?: string }[];

                while (i < lines.length) {
                    i++;
                    const line = lines[i];
                    if (ITEM_DESC_RE.test(line)) {
                        break;
                    } else {
                        const paramMatch = RETURNS_DESC_RE1.exec(line) ?? RETURNS_DESC_RE2.exec(line);
                        if (paramMatch) {
                            const [, name, desc, type] = paramMatch;
                            returnItems.push({
                                name,
                                type: type ? (type[0].toUpperCase() + type.slice(1).toLowerCase()) : undefined,
                                desc
                            });
                        }
                    }
                }

                if (returnItems.length === 1) {
                    returns = returnItems[0];
                } else {
                    // TODO: Properly define result type?
                    returns = {
                        type: `[${returnItems.map(r => r.name ?? r.type).join(', ')}]`,
                        desc: returnItems.map(r => `${r.name} - ${r.desc}`).join('\n')
                    };
                }
                break;
            }
            }
        } else {
            i++;
        }
    }

    return {
        title,
        description,
        params,
        returns
    };
};

function parseContents(contents) {
    contents = contents.replace(/\r/g, "");

    const match = DOCSTRING_RE.exec(contents);
    if (match) {
        const data = parseDocstring(match[1]);

        if (!data.title) {
            throw new Error('No title found');
        }

        documentation[data.title.toLowerCase()] = {
            source: 'cba',
            type: "function",
            title: data.title,
            description: data.description,
            syntaxes: [
                { code: `[${data.params.map(p => p.name).join(',')}] call ${data.title}`, args: data.params, returns: data.returns }
            ]
        };
    }
}

/**
 * Tries to parse all sqf files in workspace.
 */
function loadFiles() {
    walkPath(__dirname + "/CBA_A3/addons/", (file) => {
        loadFile(file);
    });
}

function loadFile(file: string) {
    fs.readFile(file, (err, data) => {
        if (err) throw err;

        // console.log("Loaded file", file);
        if (data) {
            try {
                parseContents(data.toString());
                // console.log("Loaded file contents");
                saveDocs();
            } catch (err) {
                console.error('Error parsing file', file, err);
            }
        }
    });
}

function saveDocs() {
    fs.writeFile(
        __dirname + "/cba.json",
        JSON.stringify(documentation),
        (err) => {
            if (err) throw err;
            // console.log("Saved!");
        }
    );
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
                    file = fsPath.join(path, file);

                    // console.log("Requiring stat on "+ file);
                    fs.stat(file, (err, stat) => {
                        if (err) throw err;

                        // console.log("Done stat on", file);
                        if (stat) {
                            if (stat.isDirectory()) {
                                walkPath(file, callback);
                            } else if (
                                fsPath.extname(file).toLowerCase() == ".sqf"
                            ) {
                                callback(file);
                            }
                        }
                    });
                }
            });
        });
    } finally {
        // Nothing
    }
}

loadFiles();
// loadFile('E:\\dev\\vscode-sqflint\\cba\\CBA_A3\\addons\\xeh\\fnc_addClassEventHandler.sqf');
