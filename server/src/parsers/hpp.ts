import * as pegjs from 'pegjs';
import * as fs from 'fs';
import * as fsPath from 'path';
import { SQFLint } from '../sqflint'

const hppParser = require('./grammars/pegjs-hpp') as pegjs.Parser;
const hppPreprocessor = require('./grammars/pegjs-hpp-pre') as pegjs.Parser;

interface SourceMap {
    offset: { 0: number; 1: number; 2: number; 3: number };
    filename: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Hpp {

    export class ParseError {
        constructor(
            public filename: string,
            public range: SQFLint.Range,
            public message: string
        ) {}
    }

    let preprocessorMap: SourceMap[] = [];
    export let onFilename: (filename: string) => void;

    // assigned by other class
    // eslint-disable-next-line prefer-const
    export let tryToLoad: (filename: string) => string = () => { return null; };

    // assigned by other class
    // eslint-disable-next-line prefer-const
    export let log: (contents: string) => void = () => { return; };

    export function pegjsLocationToSqflint(location: pegjs.LocationRange, useMap = false): {
        filename: string;
        range: SQFLint.Range;
    } {
        if (useMap) {
            for (const i in preprocessorMap) {
                const map = preprocessorMap[i];
                if (location.start.offset >= map.offset[0] &&
                    location.start.offset < map.offset[1]
                ) {
                    return {
                        filename: map.filename,
                        range: {
                            start: {
                                line: location.start.line - map.offset[2],
                                character: location.start.column - map.offset[3] - 1
                            },
                            end: {
                                line: location.end.line - map.offset[2],
                                character: location.end.column - map.offset[3] - 1
                            }
                        } as SQFLint.Range
                    };
                }
            }
        }

        return {
            filename: null as string,
            range: {
                start: {
                    line: location.start.line - 1,
                    character: location.start.column - 1
                },
                end: {
                    line: location.end.line - 1,
                    character: location.end.column - 1
                }
            } as SQFLint.Range
        }
    }

    const applyExtends = (context: ClassBody): ClassBody => {
        for (const i in context.classes) {
            context.classes[i].body.parent = context;

            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            applyExtendsClass(context.classes[i]);
        }

        return context;
    }

    const applyExtendsClass = (context: Class): void => {

        // console.log(`Class: ` + context.name, context.body ? context.body.variables : null);

        if (context.extends) {
            let parent = context.body.parent;
            while (parent != null) {
                const ext = parent.classes[context.extends.toLowerCase()];
                if (ext) {
                    for (const i in ext.body.variables) {
                        context.body.variables[i] = ext.body.variables[i];
                    }
                    for (const i in ext.body.classes) {
                        context.body.classes[i] = ext.body.classes[i];
                    }
                }

                if (parent.parent != null) {
                    parent = parent.parent;
                } else {
                    parent = null;
                }
            }
        }

        if (context.location) {
            const loc = context.location;
            const info = pegjsLocationToSqflint(loc, true);

            context.fileLocation = {
                filename: info.filename,
                range: info.range
            };
        }

        applyExtends(context.body);
    }

    const createParseError = (error: pegjs.PegjsError, filename: string): ParseError => {
        const info = pegjsLocationToSqflint(error.location, true);
        return new ParseError(
            info.filename || filename, info.range, error.message
        );
    }

    const preprocess = (filename: string, mapOffset = 0): string => {
        if (onFilename) {
            onFilename(filename);
        }

        try {
            let contents = tryToLoad(filename) || fs.readFileSync(filename).toString();
            const result = hppPreprocessor.parse(contents) as PreprocessorOutput;
            let offset = 0;

            const basepath = fsPath.dirname(filename);

            for (const i in result) {
                const item = result[i];
                if (item.include) {
                    const itempath = fsPath.join(basepath, item.include);

                    if (fs.existsSync(itempath)) {
                        const offsetStart = offset + item.location.start.offset;
                        const offsetEnd = offset + item.location.end.offset;
                        const offsetLine = contents.substr(0, offsetStart).split("\n").length;
                        const offsetChar = contents.substring(contents.lastIndexOf("\n", offsetStart), offsetStart).length;
                        const output = preprocess(itempath, mapOffset + offsetStart);

                        preprocessorMap.push({
                            offset: [ mapOffset + offsetStart, mapOffset + offsetStart + output.length, offsetLine, offsetChar ],
                            filename: itempath
                        });

                        contents = contents.substr(0, offsetStart) +
                            output +
                            contents.substr(offsetEnd);

                        offset += output.length;
                    } else {
                        // @TODO: Maybe continue?
                        throw new ParseError(
                            filename, pegjsLocationToSqflint(item.location).range, "Failed to find '" + itempath + "'"
                        );
                    }
                } else if (item.eval) {
                    contents = contents.substr(0, offset + item.location.start.offset) + '"";' +
                        contents.substr(offset + item.location.end.offset);
                    offset += 3;
                } else {
                    contents = contents.substr(0, offset + item.location.start.offset) +
                        contents.substr(offset + item.location.end.offset);
                }

                offset -= (item.location.end.offset - item.location.start.offset);
            }

            return contents;
        } catch (e) {
            if (e.location !== undefined) {
                throw new ParseError(
                    filename, pegjsLocationToSqflint((e as pegjs.PegjsError).location).range, e.message
                )
            } else {
                throw e;
            }
        }
    }

    export function parse(filename: string): ClassBody {
        let processed: string = null;
        preprocessorMap = [];
        try {
            processed = preprocess(filename);
            return applyExtends(hppParser.parse(processed) as ClassBody);
        } catch (e) {
            if (e.location !== undefined) {
                const location = (e as pegjs.PegjsError).location;
                const linewise = processed.split('\n').map((x) => x.replace('\r', ''));
                linewise[location.start.line - 1] = linewise[location.start.line - 1] + ' <--- ERROR LINE'
                console.log(
                    'Error while parsing ' + filename,
                    e,
                    linewise.slice(
                        Math.max(0, location.start.line - 5),
                        Math.max(0, location.start.line + 10)
                    )
                );

                /*
                if (processed) {
                    var lines = processed.split("\n");
                    for (var i = -2; i <= 2; i++) {
                        var index = location.start.line - 1 + i;
                        if (index >= 0 && index < lines.length) {
                            log(lines[index]);
                        }
                    }
                }
                */

                throw createParseError(e as pegjs.PegjsError, filename);
            } else {
                throw e;
            }
        }
    }

    export type PreprocessorOutput = IncludeOrDefine[];

    export interface IncludeOrDefine {
        include: string;
        define: string;
        eval: string;
        location: pegjs.LocationRange;
    }


    export interface ClassBody {
        parent: ClassBody;
        classes: { [name: string]: Class };
        variables: { [name: string]: string };
    }

    export interface Class {
        name: string;
        extends?: string;
        body?: ClassBody;
        location: pegjs.LocationRange;
        fileLocation: {
            filename: string;
            range: SQFLint.Range;
        };
        filename: string;
    }
}