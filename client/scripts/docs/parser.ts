import xmldoc from 'xmldoc';
import { parseTemplate } from './wiki/parser'
import { WikiDocumentation } from '../../../server/src/server'

function loadBlock(text: string, opening: string, closing: string) {
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
                result += text.substr(index, chunk)
                break;
            }
        }
        result += text.substr(index, chunk);
        index += chunk;
    }
    return result;
}

function removeMoreTags(value: string) {
    if (!value)
        return value;

    return value
        .replace(/<br>/ig, '')
        .replace(/''\(since \[.*?\]\)''/ig, '')
        .replace(/''\(since \[.*?\]\)''/ig, '')
        .replace(/''\(since .*?\)''/ig, '')
        .replace(/\(''since .*?''\)/ig, '')
        .replace(/''since [^']*''/ig, '')
        .replace(/<nowiki>(.*?)<\/nowiki>/g, '$1')
        .replace(/'''(.*?)'''/g, '$1')
        .replace(/''(.*?)''/g, '$1')
        .replace(/\[\[(.*?)\|(.*?)\]\]/g, '$2')
        .replace(/\[\[(.*?)\]\]/g, '$1')
        .replace(/ {2,}/g, ' ')
        .replace(/&nbsp;/g, '')
        .replace('{{WarningNothing', 'Nothing');
}

function fixSyntax(syntax: string) {
    syntax = removeMoreTags(syntax);

    const eq = syntax.indexOf('=');
    if (eq >= 0) {
        syntax = syntax.substr(eq + 1).trim();
    }

    return syntax.trim();
}

function polishSyntaxArgument(item: { desc: string; type: string }) {
    if (item.desc.length < 10) {
        return item.desc;
    }
    if (item.type.length > 10) {
        return item.type.substr(0, 8) + "..";
    }
    return item.type;
}

function findVariables(wiki: string) {
    return parseTemplate(wiki).parameters
}

export function parseDocument(doc: string, type: string, results = {} as Record<string, WikiDocumentation>) {
    const document = new xmldoc.XmlDocument(doc);
    const pages = document.childrenNamed("page");
    const findCommand = /{{(?:Command|Function)(?:\|Comments=)?((?:.|\n)*?\n?)}}/i;

    const placeHolder = /\/\*(?:\s*File:.*)?\s*(?:\s*Author:.*)?\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*(?:Returns|Returned value\(s\)):\s*([^]*)\s*\*\/\s*/i;
    const placeHolderWithExamples = /\/\*\s*Description:\s*([^]*)\s*(?:Parameters|Parameter\(s\)):\s*([^]*)\s*Returns:\s*([^]*)\s*Examples:\s*([^]*)\s*\*\/\s*/i;
    const placeHolderArgument = /([0-9]+):\s*([^-]*)-\s*(.*)/g;
    const placeHolderSingularArgument = /_this:\s*([^-]*)-\s*(.*)/i;
    const placeHolderReturn = /\s*([^-.:]*)(.*)/;

    const sqfTypes = [
        "bool", "string", "object", "task", "array", "scalar", "number",
        "side", "group", "boolean", "code", "config", "control", "display", "namespace"
    ];

    const noInfo = [];

    for (const i in pages) {
        const page = pages[i];

        if (parseInt(page.childNamed("ns").val) == 0) {
            let title = page.childNamed("title").val;
            const text = page.valueWithPath("revision.text");

            title = title.replace(/ /g, '_');

            const debug = false;

            const match = findCommand.exec(text);
            if (match) {
                // We're expecting either Command or Function template
                let start = text.indexOf('{{Command');
                if (start < 0) start = text.indexOf('{{Function')
                if (start < 0) throw new Error(title + ' has no start');

                // Pick only the template contents
                const wiki = loadBlock(text.substr(start), '{{', '}}');

                // Signatures computed from template
                const signatures = [];
                
                const description = {
                    plain: "",
                    formatted: ""
                };

                // List of supported games
                const games = [] as { name: string; version?: string }[];

                // List of syntaxes and their return types
                let returns = [] as string[];
                let syntax = [] as string[];

                // TODO: Utilize these
                const parameters = [];
                const examples = [];

                // Parse template
                let variables = {} as Record<string, string>;
                try {
                    variables = findVariables(wiki);
                } catch (e){
                    console.log('Failed to parse template for', title)
                    throw e
                }

                debug && console.log(wiki)
                debug && console.log(variables)

                // Convert variables to arrays
                for (let i = 1; i < 10; i++) {
                    // Command syntax - s1,s2...
                    const syntaxVal = variables[`s${i}`]
                    if (syntaxVal) {
                        syntax.push(syntaxVal)
                    }

                    // Return value for each syntax - r1,r2...
                    const returnsVal = variables[`r${i}`]
                    if (returnsVal) {
                        returns.push(returnsVal.replace(/-.*$/, ''))
                    }

                    // Parameter description for syntax
                    // For first syntax, it's p1,p2 ...p20
                    // For next syntax, it's p21, p22 ... p40
                    const currentParams = []
                    for (let p = 1; p <= 20; p++) {
                        const paramVal = variables[`p${(i-1)*20 + p}`]
                        currentParams.push(paramVal)
                    }
                    parameters.push(currentParams)

                    // Examples, not tied to syntax, x1, x2...
                    const exampleVal = variables[`x${i}`]
                    if (exampleVal) {
                        examples.push(exampleVal)
                    }

                    // Supported games as game1, game2 ...
                    const gameVal = variables[`game${i}`]
                    // Versions to go with the games, version1, version2, ...
                    const versionVal = variables[`version${i}`]
                    if (gameVal) {
                        games.push({
                            name: gameVal,
                            version: versionVal
                        })
                    }
                }

                syntax = syntax.map((item) => {
                    const commented = /<!--\s*(\[\]\s*call\s*[^;]+);\s*-->/i.exec(item);
                    if (commented) {
                        return commented[1].trim().replace(/''/g, '');
                    }
                    return item;
                });


                // Parse description
                if (variables["descr"]) {
                    let desc = variables["descr"];
                    
                    // Functions sometimes have a placeholder description extracted from code, this extracts description text
                    let match = placeHolderWithExamples.exec(desc);
                    if (!match) {
                        match = placeHolder.exec(desc);
                    }

                    if (match) {
                        desc = match[1];

                        if (match[2].trim()) {
                            const args = [];
                            let amatch = null;
                            while ((amatch = placeHolderArgument.exec(match[2]))) {
                                args.push({
                                    type: amatch[2].trim().replace(/(\s+)or(\s+)/g, "/"),
                                    desc: amatch[3].trim()
                                });
                            }

                            if (args.length > 0) {
                                syntax = ["[" + args.map((item) => polishSyntaxArgument(item)).join(", ") + "] call " + title];

                                /*
                                desc += "\r\nArguments:\r\n";
                                args.forEach((arg, index) => {
                                    // desc += "\r\n - " + (index + 1) + ": " + arg.type + " - " + arg.desc
                                    desc += "\r\n " + index + ". " + arg.type + " - " + arg.desc;
                                });
                                */
                            } else {
                                amatch = placeHolderSingularArgument.exec(match[2]);
                                if (amatch) {
                                    const arg = { type: amatch[1].trim(), desc: amatch[2].trim() };
                                    syntax = [polishSyntaxArgument(arg) + " call " + title];
                                    // desc += "\r\nArgument: _this: " + arg.type + " - " + arg.desc;
                                }
                            }
                        }

                        if (match[3].trim()) {
                            match[3] = match[3].trim();
                            const rmatch = placeHolderReturn.exec(match[3]);
                            if (rmatch) {
                                returns = [rmatch[1]];
                                // desc += "\r\n\r\nReturns: " + match[3];
                            } else if (sqfTypes.indexOf(match[3].toLowerCase()) != -1) {
                                returns = [match[3]];
                            } else {
                                returns = ["ANY"];
                                // desc += "\r\n\r\nReturns: " + match[3];
                            }
                        }
                    }


                    // Remove image tags
                    desc = desc.replace(/\[\[Image(.*?)\]\]/g, '');

                    // Only use first sentence
                    const dot = desc.search(/[^.]\.[^.]/);
                    if (dot >= 0) {
                        desc = desc.substr(0, dot + 2);
                    }

                    
                    // TODO: Maybe we should somehow add list of arguments with their description?
                    /*
                    desc += "\r\nArguments:\r\n";
                    args.forEach((arg, index) => {
                        // desc += "\r\n - " + (index + 1) + ": " + arg.type + " - " + arg.desc
                        desc += "\r\n " + index + ". " + arg.type + " - " + arg.desc;
                    });

                    desc += "\r\n\r\nReturns: " + returns
                    */

                    // Some more cleaning
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
                if (games.length > 0) {
                    description.formatted += ` _(${games.map(({name, version}) => `${name}${version ? ' ' + version : ''}`).join(' ')})_`;
                }

                description.formatted += " *([more info](https://community.bistudio.com/wiki/" + title + "))*\r\n\r\n";

                // Add signatures
                if (syntax.length > 0) {
                    for(const s in syntax) {
                        const signature = syntax[s].trim();
                        let ret = returns[s];
                        if (ret) {
                            ret = ret.trim();
                            ret = removeMoreTags(ret)
                        } else {
                            ret = undefined
                        }

                        if (ret && ret.toLowerCase() === 'nothing') {
                            ret = undefined
                        }

                        signatures.push({
                            signature: removeMoreTags(signature),
                            returns: ret
                        });
                    }
                } else {
                    signatures.push({
                        signature: title
                    });
                }

                debug && console.log(description)
                debug && console.log(signatures)

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
        console.log('No informations for ' + noInfo.length + ' commands/functions. Example: ' + noInfo.slice(0, 3).join(','));
    }

    return results;
}