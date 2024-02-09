import fs from "fs";
import fsPath from "path";
import { WikiDocumentation } from "../server/src/server";

const documentation = {} as Record<string, WikiDocumentation>;

const COMMENT_RE = /\/\*(.*?)\*\//ms;
const STAR_RE = /\n \* ?/gm;
const ARGS_RE = /Arguments:\s*\n(.*?)\n\s*\n/is;
const ARG_RE = /^([0-9]+):\s*(.*?)<([^>]*)>(?: \(default:\s*([^)]*)\))?/gm;
const RETURNS_RE = /Return Value:\s*\n(.*?)\n\s*\n/is;
const PUBLIC_RE = /Public:\s*(.*)/i;

function parseContents(fnc, contents) {
    contents = contents.replace(/\r/g, "");

    let match = COMMENT_RE.exec(contents);

    if (match) {
        const contents = match[1]
            .replace(STAR_RE, "\n")
            .replace(/ \* Author:/, "Author:");

        const args = ARGS_RE.exec(contents);
        const returns = RETURNS_RE.exec(contents);
        const isPublic = PUBLIC_RE.exec(contents);
        const lines = contents.split("\n");
        const desc = lines[2];

        if (isPublic && isPublic[1].trim().toLowerCase() !== "yes") {
            return;
        }

        const params = [] as {
            type: string;
            description: string;
            optional?: boolean;
            default?: string;
        }[];
        if (args) {
            while ((match = ARG_RE.exec(args[1]))) {
                const arg: {
                    type: string;
                    description: string;
                    optional?: boolean;
                    default?: string;
                } = {
                    type: match[3],
                    description: match[2],
                };

                if (match[4] !== undefined) {
                    arg.optional = true;
                    arg.default = match[4];
                }

                params.push(arg);
            }
        }

        let signature = `call ${fnc}`;
        if (params.length > 0) {
            signature =
                "[" +
                params
                    .map((param, index) => {
                        const name = `_${param.type.toLowerCase()}${index}`;

                        if (param.optional && param.default) {
                            return `${name}=${param.default}`;
                        }

                        return name;
                    })
                    .join(",") +
                "] call " +
                fnc;
        }

        documentation[fnc.toLowerCase()] = {
            type: "function",
            title: fnc,
            source: "ace3",
            description: desc,
            syntaxes: [
                {
                    returns: returns ? { type: returns[1] } : undefined,
                    args: params.map((p, i) => ({
                        name: `_${p.type}${i}`,
                        type: p.type,
                        desc: p.description,
                        default: p.default,
                        optional: p.optional,
                    })),
                    code: signature,
                },
            ],
        };
    } else {
        console.log("No comment in " + fnc);
    }
}

/**
 * Tries to parse all sqf files in workspace.
 */
function loadFiles() {
    walkPath(__dirname + "/ACE3/addons/", (file, fnc) => {
        fs.readFile(file, (err, data) => {
            if (err) throw err;

            if (data) {
                parseContents(fnc, data.toString());
                saveDocs();
            }
        });
    });
}

function saveDocs() {
    fs.writeFile(
        __dirname + "/ace3.json",
        JSON.stringify(documentation),
        (err) => {
            if (err) throw err;
        }
    );
}

/**
 * Walks specified path while calling callback for each sqf file found.
 */
function walkPath(path, callback) {
    try {
        fs.readdir(path, (err, files) => {
            if (err) throw err;

            files.forEach((addon) => {
                const addonDir = fsPath.join(path, addon, "functions");
                fs.readdir(addonDir, (err, files) => {
                    if (err) {
                        console.log(`No functions for ${addon}`);
                        console.log(err.toString());
                        return;
                    }

                    files.forEach((func) => {
                        if (fsPath.extname(func).toLowerCase() === ".sqf") {
                            callback(
                                fsPath.join(addonDir, func),
                                `ACE_${addon}_${func
                                    .split(".")
                                    .slice(0, -1)
                                    .join(".")}`
                            );
                        }
                    });
                });
            });
        });
    } finally {
        // Do nothing here
    }
}

loadFiles();
