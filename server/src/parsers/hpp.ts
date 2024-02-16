import {
    PreprocessorError,
    preprocess as preprocessFile,
} from "@bi-tools/preprocessor";
import * as fs from "fs";
import * as fsPath from "path";
import * as pegjs from "pegjs";
import { SqfParserTypes } from "../sqfParserTypes";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const hppParser = require("./grammars/pegjs-hpp") as pegjs.Parser;

interface SourceMap {
    offset: { 0: number; 1: number; 2: number; 3: number };
    filename: string;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Hpp {
    export class ParseError {
        constructor(
            public filename: string,
            public range: SqfParserTypes.Range,
            public message: string
        ) {}
    }

    let paths = {} as Record<string, string>;
    export const setPaths = (newPaths: Record<string, string>): void => {
        paths = newPaths;
    };

    let preprocessorMap: SourceMap[] = [];
    export let onFilename: (filename: string) => void;

    // assigned by other class
    // eslint-disable-next-line prefer-const
    export let tryToLoad: (
        filename: string,
        sourceFilename: string
    ) => string = () => {
        return null;
    };

    // assigned by other class
    // eslint-disable-next-line prefer-const
    export let log: (contents: string) => void = () => {
        return;
    };

    export function pegjsLocationToSqflint(
        location: pegjs.LocationRange,
        useMap = false
    ): {
        filename: string;
        range: SqfParserTypes.Range;
    } {
        if (useMap) {
            for (const i in preprocessorMap) {
                const map = preprocessorMap[i];
                if (
                    location.start.offset >= map.offset[0] &&
                    location.start.offset < map.offset[1]
                ) {
                    return {
                        filename: map.filename,
                        range: {
                            start: {
                                line: location.start.line - map.offset[2],
                                character:
                                    location.start.column - map.offset[3] - 1,
                            },
                            end: {
                                line: location.end.line - map.offset[2],
                                character:
                                    location.end.column - map.offset[3] - 1,
                            },
                        } as SqfParserTypes.Range,
                    };
                }
            }
        }

        return {
            filename: null as string,
            range: {
                start: {
                    line: location.start.line - 1,
                    character: location.start.column - 1,
                },
                end: {
                    line: location.end.line - 1,
                    character: location.end.column - 1,
                },
            } as SqfParserTypes.Range,
        };
    }

    const applyExtends = (context: ClassBody): ClassBody => {
        for (const i in context.classes) {
            context.classes[i].body.parent = context;

            // eslint-disable-next-line @typescript-eslint/no-use-before-define
            applyExtendsClass(context.classes[i]);
        }

        return context;
    };

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
                range: info.range,
            };
        }

        applyExtends(context.body);
    };

    const resolveFilename = (filename: string, root: string): string => {
        for (const [prefix, newTarget] of Object.entries(paths)) {
            if (filename.startsWith(prefix)) {
                filename = filename.replace(prefix, newTarget);

                if (fsPath.isAbsolute(newTarget)) {
                    return filename;
                }

                return fsPath.join(root, filename);
            }
        }

        return fsPath.join(root, filename);
    };

    const preprocess = async (filename: string) => {
        const contents =
            tryToLoad(filename, filename) ||
            fs.readFileSync(filename).toString();

        const processed = await preprocessFile(contents, {
            filename,
            async resolveFn(param, sourceFilename) {
                const resolvedFname = resolveFilename(
                    param,
                    fsPath.dirname(sourceFilename)
                );

                const contents = await (tryToLoad(
                    resolvedFname,
                    sourceFilename
                ) || fs.promises.readFile(resolvedFname, "utf-8"));

                return {
                    filename: resolvedFname,
                    contents,
                };
            },
        });

        return processed.code;
    };

    export async function parse(filename: string): Promise<ClassBody> {
        let processed: string = null;
        preprocessorMap = [];
        try {
            processed = await preprocess(filename);
            return applyExtends(hppParser.parse(processed) as ClassBody);
        } catch (e) {
            console.log(await preprocess(filename));

            if (e instanceof PreprocessorError) {
                throw new ParseError(
                    filename,
                    new SqfParserTypes.Range(
                        new SqfParserTypes.Position(0, 0),
                        new SqfParserTypes.Position(0, 0)
                    ),
                    e.message
                );
            }

            throw e;
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
            range: SqfParserTypes.Range;
        };
        filename: string;
    }
}
