import {
    getLocationFromOffset,
    getMappedOffsetAt,
    preprocess,
} from "@bi-tools/preprocessor";
import { analyzeSqf } from "@bi-tools/sqf-analyzer";
import {
    SqfParserError,
    TokenizerError,
    parseSqfTokens,
    tokenizeSqf,
} from "@bi-tools/sqf-parser";
import * as fs from "fs";
import * as path from "path";
import { performance } from "perf_hooks";
import { Logger } from "./lib/logger";
import { LoggerContext } from "./lib/loggerContext";

type Options = {
    includePrefixes: Map<string, string>;
};

export class SqfParser {
    private logger: Logger;

    constructor(context: LoggerContext) {
        this.logger = context.createLogger("SqfParser");
    }

    private async resolveImport(
        includeParam: string,
        root: string,
        options: Options
    ): Promise<{ contents: string; filename: string }> {
        const matchPrefix = (path: string) =>
            includeParam.toLowerCase().startsWith(path.toLowerCase()) ||
            includeParam.toLowerCase().startsWith(`\\${path.toLowerCase()}`);

        const matchingPrefix = [...options.includePrefixes.entries()].find(
            ([p]) => matchPrefix(p)
        );

        const replacePrefix = (prefix: string, include: string) => {
            if (include.toLowerCase().startsWith(prefix.toLowerCase())) {
                return include.substring(prefix.length);
            }

            if (include.toLowerCase().startsWith(`\\${prefix.toLowerCase()}`)) {
                return include.substring(prefix.length + 1);
            }

            return include;
        };

        const resolved = matchingPrefix
            ? path.join(
                matchingPrefix[1],
                replacePrefix(matchingPrefix[0], includeParam)
            )
            : path.resolve(root, includeParam);

        try {
            const contents = await fs.promises.readFile(resolved, "utf-8");

            return {
                contents,
                filename: resolved,
            };
        } catch (err) {
            return { contents: "", filename: "" };
        }
    }

    /**
     * Parses content and returns result wrapped in helper classes.
     */
    public async parse(
        filename: string,
        contents: string,
        options?: Options
    ): Promise<SqfParser.ParseInfo> {
        this.logger.info("Parsing file: " + filename);

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
                try {
                    return this.resolveImport(
                        includeParam,
                        path.dirname(sourceFilename),
                        options
                    );
                } catch (err) {
                    preprocessErrors.push({ err, position });

                    return { contents: "", filename: "" };
                }
            };

            let start = performance.now();

            const preprocessed = await preprocess(contents, {
                filename,
                resolveFn: resolveImport,
            });

            //console.log(preprocessed);

            this.logger.info(
                `${filename} preprocessed in ${performance.now() - start}ms`
            );

            const sourceMap = preprocessed.sourceMap;

            // TODO: This should be cached when doing workspace indexing
            const fileContents = {} as Record<string, string>;
            const fileContentsLoaders = {} as Record<string, Promise<string>>;

            const getContents = async (filename: string) => {
                if (!fileContents[filename]) {
                    try {
                        const loader = fileContentsLoaders[filename] ?? (fileContentsLoaders[filename] = fs.promises.readFile(
                            filename,
                            "utf-8"
                        ));

                        fileContents[filename] = await loader;

                        delete fileContentsLoaders[filename];
                    } catch (err) {
                        console.error(
                            "Failed to load source map file",
                            filename,
                            err
                        );

                        fileContents[filename] = "";
                    }
                }
                return fileContents[filename];
            };

            const getProperOffset = async (offset: number) => {
                // TODO: This function is slow if you have tons of sourceMaps
                const mapped = getMappedOffsetAt(sourceMap, offset, filename);

                const location = getLocationFromOffset(
                    mapped.offset,
                    await getContents(mapped.file)
                );

                return location;
            };

            // TODO: This is the slowest part of this function, hard to optimize now
            const offsetsToRange = async (start: number, end: number) => {
                const startLocation = await getProperOffset(start);
                const endLocation = await getProperOffset(end);

                //console.log({start,end}, '->', {startLocation, endLocation});

                return new SqfParser.Range(
                    new SqfParser.Position(
                        startLocation.line - 1,
                        startLocation.column - 1
                    ),
                    new SqfParser.Position(
                        endLocation.line - 1,
                        endLocation.column - 1
                    )
                );
            };

            try {
                start = performance.now();

                const tokens = tokenizeSqf(preprocessed.code);

                this.logger.info(
                    `${filename} tokenized in ${performance.now() - start}ms`
                );

                start = performance.now();

                const { errors, script } = parseSqfTokens(tokens);

                this.logger.info(
                    `${filename} parsed in ${performance.now() - start}ms`
                );

                start = performance.now();

                const analysis = analyzeSqf(script, tokens, preprocessed.code);

                this.logger.info(
                    `${filename} analyzed in ${performance.now() - start}ms`
                );

                start = performance.now();

                const variables = await Promise.all(
                    Array.from(analysis.variables.values()).map(async (v) => ({
                        name: v.originalName,
                        comment: this.parseComment(
                            v.assignments
                                .map((a) => a.comment)
                                .find((a) => !!a) ?? ""
                        ),
                        ident: v.originalName,
                        usage: await Promise.all(
                            v.usage.map((d) => offsetsToRange(d[0], d[1]))
                        ),
                        isLocal(): boolean {
                            return this.name.charAt(0) == "_";
                        },
                        definitions: await Promise.all(
                            v.assignments.map((d) =>
                                offsetsToRange(d.position[0], d.position[1])
                            )
                        ),
                    }))
                );

                this.logger.info(
                    `${filename} variables processed in ${
                        performance.now() - start
                    }ms`
                );

                start = performance.now();

                const macros = await Promise.all(
                    [...preprocessed.defines.values()].map(
                        async (d): Promise<SqfParser.MacroInfo> => ({
                            name: d.name,
                            arguments: d.args.join(","),
                            definitions: [
                                {
                                    value: typeof d.value === 'function' ? d.value() : d.value,
                                    filename: d.file,
                                    position: await offsetsToRange(
                                        d.location[0],
                                        d.location[1]
                                    ),
                                },
                            ],
                        })
                    )
                );

                this.logger.info(
                    `${filename} macros processed in ${
                        performance.now() - start
                    }ms`
                );

                return {
                    errors: [
                        ...(await Promise.all(
                            preprocessErrors.map(
                                async (e) =>
                                    new SqfParser.Error(
                                        e.err.message,
                                        await offsetsToRange(
                                            e.position[0],
                                            e.position[1]
                                        )
                                    )
                            )
                        )),
                        ...(await Promise.all(
                            errors.map(
                                async (e) =>
                                    new SqfParser.Error(
                                        e.message,
                                        await offsetsToRange(
                                            e.token.position.from,
                                            e.token.position.to
                                        )
                                    )
                            )
                        )),
                    ],
                    warnings: [],
                    variables,
                    includes: [...preprocessed.includes.entries()].map(([filename, expanded]) => ({ expanded, filename })),
                    macros,
                };
            } catch (err) {
                console.error("failed to parse", filename, err);

                if (err instanceof TokenizerError) {
                    console.log(preprocessed.code.slice(err.offset - 100, err.offset + 100));
                }

                return {
                    errors: [
                        ...(await Promise.all(
                            preprocessErrors.map(
                                async (e) =>
                                    new SqfParser.Error(
                                        e.err.message,
                                        await offsetsToRange(
                                            e.position[0],
                                            e.position[1]
                                        )
                                    )
                            )
                        )),
                        new SqfParser.Error(
                            err.message,
                            err instanceof SqfParserError
                                ? await offsetsToRange(
                                    err.token.position.from,
                                    err.token.position.to
                                )
                                : new SqfParser.Range(
                                    new SqfParser.Position(0, 0),
                                    new SqfParser.Position(0, 0)
                                )
                        ),
                    ],
                    warnings: [],
                    variables: [],
                    includes: [...preprocessed.includes.entries()].map(([filename, expanded]) => ({ expanded, filename })),
                    macros: [],
                };
            }
        } catch (err) {
            console.error("failed to pre-process", filename, err);

            return {
                errors: [
                    new SqfParser.Error(
                        err.message,
                        new SqfParser.Range(
                            new SqfParser.Position(0, 0),
                            new SqfParser.Position(0, 0)
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
export namespace SqfParser {
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
        macros: MacroInfo[] = [];
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
    export class MacroInfo {
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
