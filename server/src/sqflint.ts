import {
    getLocationFromOffset,
    getMappedOffsetAt,
    preprocess,
} from "@bi-tools/preprocessor";
import { analyzeSqf } from "@bi-tools/sqf-analyzer";
import {
    SqfParserError,
    parseSqfTokens,
    tokenizeSqf,
} from "@bi-tools/sqf-parser";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./lib/logger";
import { LoggerContext } from "./lib/logger-context";

type Options = {
    includePrefixes: Map<string, string>;
}

/**
 * Class allowing abstract interface for accessing sqflint CLI.
 */
export class SQFLint {
    private logger: Logger;

    constructor(context: LoggerContext) {
        this.logger = context.createLogger("sqflint");
    }

    /**
     * Parses content and returns result wrapped in helper classes.
     */
    public async parse(
        filename: string,
        contents: string,
        options?: Options
    ): Promise<SQFLint.ParseInfo> {
        try {
            const preprocessErrors = [] as {
                err: Error;
                position: [start: number, end: number];
            }[];

            const resolveImport = async (
                includeParam: string,
                sourceFilename: string,
                position: [number, number]
            ) => {
                const resolved = path.resolve(
                    path.dirname(sourceFilename),
                    includeParam
                );

                try {
                    const contents = await fs.promises.readFile(
                        resolved,
                        "utf-8"
                    );

                    return {
                        contents,
                        filename: resolved,
                    };
                } catch (err) {
                    preprocessErrors.push({ err, position });

                    return { contents: "", filename: "" };
                }
            };

            const preprocessed = await preprocess(contents, {
                filename,
                resolveFn: resolveImport,
            });

            const sourceMap = preprocessed.sourceMap;
            const fileContents = {} as Record<string, string>;

            const getContents = async (filename: string) => {
                if (!fileContents[filename]) {
                    try {
                        fileContents[filename] = await fs.promises.readFile(
                            filename,
                            "utf-8"
                        );
                    } catch (err) {
                        console.error('Failed to load source map file', filename, err)

                        fileContents[filename] = "";
                    }
                }
                return fileContents[filename];
            };

            const getProperOffset = async (offset: number) => {
                const mapped = getMappedOffsetAt(sourceMap, offset, filename);

                const location = getLocationFromOffset(
                    mapped.offset,
                    await getContents(mapped.file)
                );

                return location;
            };

            const offsetsToRange = async (start: number, end: number) => {
                const startLocation = await getProperOffset(start);
                const endLocation = await getProperOffset(end);

                return new SQFLint.Range(
                    new SQFLint.Position(
                        startLocation.line - 1,
                        startLocation.column - 1
                    ),
                    new SQFLint.Position(
                        endLocation.line - 1,
                        endLocation.column - 1
                    )
                );
            };

            try {
                const tokens = tokenizeSqf(preprocessed.code);
                const data = parseSqfTokens(tokens, filename);
                const analysis = analyzeSqf(data, tokens, preprocessed.code);

                return {
                    errors: [
                        ...(await Promise.all(
                            preprocessErrors.map(
                                async (e) =>
                                    new SQFLint.Error(
                                        e.err.message,
                                        await offsetsToRange(
                                            e.position[0],
                                            e.position[1]
                                        )
                                    )
                            )
                        )),
                    ],
                    warnings: [],
                    variables: await Promise.all(
                        Array.from(analysis.variables.values()).map(
                            async (v) => ({
                                name: v.originalName,
                                comment: this.parseComment(
                                    v.assignments
                                        .map((a) => a.comment)
                                        .find((a) => !!a) ?? ""
                                ),
                                ident: v.originalName,
                                usage: await Promise.all(
                                    v.usage.map((d) =>
                                        offsetsToRange(d[0], d[1])
                                    )
                                ),
                                isLocal(): boolean {
                                    return this.name.charAt(0) == "_";
                                },
                                definitions: await Promise.all(
                                    v.assignments.map((d) =>
                                        offsetsToRange(
                                            d.position[0],
                                            d.position[1]
                                        )
                                    )
                                ),
                            })
                        )
                    ),
                    includes: [],
                    macros: [],
                };
            } catch (err) {
                console.error('failed to parse', filename, err);
                console.log(preprocessed.code);

                return {
                    errors: [
                        ...(await Promise.all(
                            preprocessErrors.map(
                                async (e) =>
                                    new SQFLint.Error(
                                        e.err.message,
                                        await offsetsToRange(
                                            e.position[0],
                                            e.position[1]
                                        )
                                    )
                            )
                        )),
                        new SQFLint.Error(
                            err.message,
                            err instanceof SqfParserError
                                ? await offsetsToRange(
                                      err.token.position.from,
                                      err.token.position.to
                                  )
                                : new SQFLint.Range(
                                      new SQFLint.Position(0, 0),
                                      new SQFLint.Position(0, 0)
                                  )
                        ),
                    ],
                    warnings: [],
                    variables: [],
                    includes: [],
                    macros: [],
                };
            }
        } catch (err) {
            console.error('failed to pre-process', filename, err);

            return {
                errors: [
                    new SQFLint.Error(
                        err.message,
                        new SQFLint.Range(
                            new SQFLint.Position(0, 0),
                            new SQFLint.Position(0, 0)
                        )
                    ),
                ],
                warnings: [],
                variables: [],
                includes: [],
                macros: [],
            };
        }
    }

    /**
     * Removes comment specific characters and trims the comment.
     */
    private parseComment(comment: string): string {
        if (comment) {
            comment = comment.trim();
            if (comment.indexOf("//") == 0) {
                comment = comment.substr(2).trim();
            }

            if (comment.indexOf("/*") == 0) {
                const clines = comment
                    .substr(2, comment.length - 4)
                    .trim()
                    .split("\n");
                for (const c in clines) {
                    let cline = clines[c].trim();
                    if (cline.indexOf("*") == 0) {
                        cline = cline.substr(1).trim();
                    }
                    clines[c] = cline;
                }
                comment = clines
                    .filter((i) => !!i)
                    .join("\r\n")
                    .trim();
            }
        }

        return comment;
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace SQFLint {
    /**
     * Base message.
     */
    class Message {
        constructor(
            public message: string,
            public range: Range,
            public filename?: string
        ) {}
    }

    /**
     * Error in code.
     */
    export class Error extends Message {}

    /**
     * Warning in code.
     */
    export class Warning extends Message {}

    /**
     * Contains info about parse result.
     */
    export class ParseInfo {
        errors: Error[] = [];
        warnings: Warning[] = [];
        variables: VariableInfo[] = [];
        macros: Macroinfo[] = [];
        includes: IncludeInfo[] = [];
        timeNeededSqfLint?: number;
        timeNeededMessagePass?: number;
    }

    export class IncludeInfo {
        filename: string;
        expanded: string;
    }

    /**
     * Contains info about variable used in document.
     */
    export class VariableInfo {
        name: string;
        ident: string;
        comment: string;
        definitions: Range[];
        usage: Range[];

        public isLocal(): boolean {
            return this.name.charAt(0) == "_";
        }
    }

    /**
     * Info about macro.
     */
    export class Macroinfo {
        name: string;
        arguments: string = null;
        definitions: MacroDefinition[];
    }

    /**
     * Info about one specific macro definition.
     */
    export class MacroDefinition {
        position: Range;
        value: string;
        filename: string;
    }

    /**
     * vscode compatible range
     */
    export class Range {
        constructor(public start: Position, public end: Position) {}
    }

    /**
     * vscode compatible position
     */
    export class Position {
        constructor(public line: number, public character: number) {}
    }

    export interface Options {
        checkPaths?: boolean;
        pathsRoot?: string;
        ignoredVariables?: string[];
        includePrefixes?: { [key: string]: string };
        contextSeparation?: boolean;
    }
}
