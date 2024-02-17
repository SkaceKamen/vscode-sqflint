import { preprocess } from "@bi-tools/preprocessor";
import { analyzeSqf } from "@bi-tools/sqf-analyzer";
import { lintSqf } from "@bi-tools/sqf-linter";
import {
    SqfParserError,
    TokenizerError,
    parseSqfTokens,
    tokenizeSqf,
} from "@bi-tools/sqf-parser";
import * as fs from "fs";
import * as path from "path";
import { Logger } from "./lib/logger";
import { LoggerContext } from "./lib/loggerContext";
import { OffsetsMapper } from "./lib/offsetsMapper";
import { SqfParserTypes } from "./sqfParserTypes";

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
    ): Promise<SqfParserTypes.ParseInfo> {
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

            const preprocessed = await this.logger.measure("preprocess", () =>
                preprocess(contents, {
                    filename,
                    resolveFn: resolveImport,
                })
            );

            const preErrors = await Promise.all(
                preprocessErrors.map(
                    async (e) =>
                        new SqfParserTypes.Error(
                            e.err.message,
                            await mapper.offsetsToRange(
                                e.position[0],
                                e.position[1]
                            )
                        )
                )
            );

            const includes = [...preprocessed.includes.entries()].flatMap(
                ([document, includes]) =>
                    [...includes.entries()].map(([filename, expanded]) => ({
                        document,
                        expanded,
                        filename,
                    }))
            );

            const sourceMap = preprocessed.sourceMap;
            const mapper = new OffsetsMapper(filename, sourceMap);

            try {
                const tokens = this.logger.measureSync("tokenize", () =>
                    tokenizeSqf(preprocessed.code)
                );
                const { errors, script } = this.logger.measureSync(
                    "parse",
                    () => parseSqfTokens(tokens)
                );
                const analysis = this.logger.measureSync("analyze", () =>
                    analyzeSqf(script, tokens, preprocessed.code)
                );

                const linting = await this.logger.measure("linting", () =>
                    lintSqf(script, preprocessed.code)
                );

                const variables = await this.logger.measure("variables", () =>
                    Promise.all(
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
                                        mapper.offsetsToRange(d[0], d[1])
                                    )
                                ),
                                isLocal(): boolean {
                                    return this.name.charAt(0) == "_";
                                },
                                definitions: await Promise.all(
                                    v.assignments.map((d) =>
                                        mapper.offsetsToRange(
                                            d.position[0],
                                            d.position[1]
                                        )
                                    )
                                ),
                            })
                        )
                    )
                );

                const macros = await this.logger.measure("macros", () =>
                    Promise.all(
                        [...preprocessed.defines.values()].map(
                            async (d): Promise<SqfParserTypes.MacroInfo> => ({
                                name: d.name,
                                arguments: d.args.join(","),
                                definitions: [
                                    {
                                        value:
                                            typeof d.value === "function"
                                                ? d.value()
                                                : d.value,
                                        filename: d.file,
                                        position: await mapper.offsetsToRange(
                                            d.location[0],
                                            d.location[1],
                                            // Macro positions are already mapped to proper file so we don't need to map them again
                                            d.file
                                        ),
                                    },
                                ],
                            })
                        )
                    )
                );

                /*
                if (errors.length > 0) {
                    console.log('---');
                    console.log(preprocessed.code);
                    console.log('---');
                    for (const error of errors) {
                        console.log(error.message, error.token);
                    }
                }

                console.log('---');
                console.log(preprocessed.code);
                console.log('---');
                console.log(preprocessed.sourceMap);
                */

                return {
                    errors: [
                        ...preErrors,
                        ...(await Promise.all(
                            errors.map(
                                async (e) =>
                                    new SqfParserTypes.Error(
                                        e.message,
                                        await mapper.offsetsToRange(
                                            e.token.position[0],
                                            e.token.position[1]
                                        )
                                    )
                            )
                        )),
                    ],
                    warnings: [
                        ...(await Promise.all(
                            linting.map(
                                async (e) =>
                                    new SqfParserTypes.Warning(
                                        e.message,
                                        await mapper.offsetsToRange(
                                            e.position[0],
                                            e.position[1]
                                        )
                                    )
                            )
                        )),
                    ],
                    variables,
                    includes,
                    macros,
                };
            } catch (err) {
                console.error("failed to parse", filename, err);

                if (err instanceof TokenizerError) {
                    console.log(
                        preprocessed.code.slice(
                            err.offset - 100,
                            err.offset + 100
                        )
                    );
                }

                return {
                    errors: [
                        ...preErrors,
                        new SqfParserTypes.Error(
                            err.message,
                            err instanceof SqfParserError
                                ? await mapper.offsetsToRange(
                                    err.token.position[0],
                                    err.token.position[1]
                                )
                                : new SqfParserTypes.Range(
                                    new SqfParserTypes.Position(0, 0),
                                    new SqfParserTypes.Position(0, 0)
                                )
                        ),
                    ],
                    warnings: [],
                    variables: [],
                    includes,
                    macros: [],
                };
            }
        } catch (err) {
            console.error("failed to pre-process", filename, err);

            return {
                errors: [
                    new SqfParserTypes.Error(
                        err.message,
                        new SqfParserTypes.Range(
                            new SqfParserTypes.Position(0, 0),
                            new SqfParserTypes.Position(0, 0)
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
