import fs from "fs";
import path from "path";
import { WikiDocumentation } from "../server/src/server";

async function main() {
    const commands: Record<string, WikiDocumentation> = JSON.parse(
        (
            await fs.promises.readFile(
                path.join(__dirname, "../definitions/documentation.json")
            )
        ).toString()
    );

    const controlStatements = [
        "then",
        "do",
        "else",
        "exit",
        "exitWith",
        "for",
        "forEach",
        "if",
        "return",
        "switch",
        "case",
        "default",
        "while",
        "from",
        "to",
        "step",
        "forEachMember",
        "forEachMemberAgent",
        "forEachMemberTeam",
    ];

    const vObjectStatements = ["player", "cursorTarget"];

    const declarationCompile = ["compile", "compileFinal"];

    const codeManagers = [
        "compile",
        "compileFinal",
        "exec",
        "execFSM",
        "execVM",
        "callExtension",
    ];

    const booleanLiterals = ["false", "true"];

    const fnCalls = ["call", "spawn"];

    const propertyAccessors = ["get", "set", "select"];

    const accessModifiers = ["private"];

    const highlightedCommands = Object.values(commands)
        .map((c) => c.title)
        .filter(
            (c) =>
                /^\w+$/.test(c) &&
                !controlStatements.includes(c) &&
                !vObjectStatements.includes(c) &&
                !declarationCompile.includes(c) &&
                !codeManagers.includes(c) &&
                !fnCalls.includes(c) &&
                !propertyAccessors.includes(c) &&
                !accessModifiers.includes(c) &&
                !booleanLiterals.includes(c)
        )
        .sort();

    const wordMatch = (words: string[]) => `\\s*(?i)(${words.join("|")})\\b`;

    const grammar = {
        fileTypes: ["sqf"],
        name: "sqf",
        scopeName: "source.sqf",
        patterns: [{ include: "#expression" }],
        repository: {
            "access-modifier": {
                match: wordMatch(accessModifiers),
                name: "storage.modifier.sqf",
            },
            "array-literal": {
                begin: "\\[",
                beginCaptures: {
                    "0": {
                        name: "meta.brace.square.sqf",
                    },
                },
                end: "\\]",
                endCaptures: {
                    "0": {
                        name: "meta.brace.square.sqf",
                    },
                },
                name: "meta.array.literal.sqf",
                patterns: [
                    {
                        include: "#expression",
                    },
                ],
            },
            "assignment-operator": {
                match: "=",
                name: "keyword.operator.assignment.sqf",
            },
            block: {
                begin: "\\{",
                beginCaptures: {
                    "0": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                end: "\\}",
                endCaptures: {
                    "0": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.block.sqf",
                patterns: [
                    {
                        include: "#expression",
                    },
                    {
                        include: "#object-member",
                    },
                ],
            },
            "boolean-literal": {
                match: "(\\s*)(false|true)\\b",
                name: "constant.language.boolean.sqf",
            },
            comment: {
                name: "comment.sqf",
                patterns: [
                    {
                        include: "#comment-block",
                    },
                    {
                        include: "#comment-line",
                    },
                ],
            },
            "comment-block": {
                begin: "/\\*",
                end: "\\*/",
                name: "comment.block.sqf",
            },
            "comment-line": {
                match: "(//).*$\\n?",
                name: "comment.line.sqf",
            },
            "comparison-operator": {
                match: "==|!=|>|<|greater|greater=|less|less=|not",
                name: "keyword.operator.comparison.sqf",
            },
            "condition-operator": {
                match: "!|&&|\\|\\||:|([^A-Za-z0-9]|\\b)and([^A-Za-z0-9]|\\b)|([^A-Za-z0-9])or([^A-Za-z0-9])",
                name: "keyword.operator.condition.sqf",
            },
            "control-statement": {
                match: wordMatch(controlStatements),
                name: "keyword.control.sqf",
            },
            "decl-block": {
                begin: "\\{",
                beginCaptures: {
                    "0": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                end: "\\}",
                endCaptures: {
                    "0": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.decl.block.sqf",
                patterns: [
                    {
                        include: "#expression",
                    },
                ],
            },
            "vObject-statements": {
                match: wordMatch(vObjectStatements),
                name: "variable.language.vobject.sqf",
            },
            other: {
                name: "meta.expression.sqf",
                patterns: [
                    {
                        include: "#access-modifier",
                    },
                    {
                        include: "#property-accessor",
                    },
                ],
            },
            expression: {
                name: "meta.expression.sqf",
                patterns: [
                    {
                        include: "#string",
                    },
                    {
                        include: "#comment",
                    },
                    {
                        include: "#literal",
                    },
                    {
                        include: "#paren-expression",
                    },
                    {
                        include: "#block",
                    },
                    {
                        include: "#comparison-operator",
                    },
                    {
                        include: "#condition-operator",
                    },
                    {
                        include: "#manipulative-operator",
                    },
                    {
                        include: "#assignment-operator",
                    },
                    {
                        include: "#control-statement",
                    },
                    {
                        include: "#code-managers",
                    },
                    {
                        include: "#statements",
                    },
                    {
                        include: "#other",
                    },
                    {
                        include: "#declaration",
                    },
                ],
            },
            statements: {
                name: "meta.expression.sqf",
                patterns: [
                    {
                        include: "#vObject-statements",
                    },
                    {
                        include: "#COMMAND",
                    },
                ],
            },
            COMMAND: {
                name: "entity.name.function.sqf",
                match: wordMatch(highlightedCommands),
            },
            declaration: {
                name: "meta.declaration.sqf",
                patterns: [
                    {
                        include: "#fnc-call",
                    },
                    {
                        include: "#fnc-declaration",
                    },
                    {
                        include: "#fnc-declaration-compile",
                    },
                    {
                        include: "#var-declaration-priv",
                    },
                    {
                        include: "#var-declaration",
                    },
                    {
                        include: "#var-call-priv",
                    },
                    {
                        include: "#var-call",
                    },
                ],
            },
            "var-declaration": {
                begin: "([_a-zA-Z_0-9]+)(\\s*)(=+)",
                beginCaptures: {
                    "1": {
                        name: "variable.other.sqf",
                    },
                    "3": {
                        name: "keyword.operator.assignment.sqf",
                    },
                },
                end: " |;|{|}|\t|=|(|)|[|]",
                endCaptures: {
                    "1": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "var-declaration-priv": {
                begin: "(_+)([_a-zA-Z_0-9]+)(\\s*)(=+)",
                beginCaptures: {
                    "1": {
                        name: "variable.other.private.sqf",
                    },
                    "2": {
                        name: "variable.other.private.sqf",
                    },
                    "4": {
                        name: "keyword.operator.assignment.sqf",
                    },
                },
                end: " |;|{|}|\t|=|(|)|[|]",
                endCaptures: {
                    "1": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "fnc-declaration": {
                begin: "(\\s*)([_a-zA-Z_0-9]+)(\\s*)(=)(\\s*)({)",
                beginCaptures: {
                    "2": {
                        name: "support.function.sqf",
                    },
                    "4": {
                        name: "keyword.operator.assignment.sqf",
                    },
                    "6": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                end: " |;|{|}|\t",
                endCaptures: {
                    "1": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "fnc-declaration-compile": {
                begin: "(\\s*)([_a-zA-Z_0-9]+)(\\s*)(=)(\\s*)(compileFinal|compile)",
                beginCaptures: {
                    "2": {
                        name: "support.function.sqf",
                    },
                    "4": {
                        name: "keyword.operator.assignment.sqf",
                    },
                    "6": {
                        name: "meta.function-call.sqf",
                    },
                },
                end: " |;|{|}|\t",
                endCaptures: {
                    "1": {
                        name: "meta.brace.curly.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "code-managers": {
                match: "(\\s*)(compile|compileFinal|exec|execFSM|execVM|callExtension)\\b",
                name: "meta.function-call.sqf",
            },
            "fnc-call": {
                begin: "(\\s*)(call|spawn)(\\s+)([a-zA-Z_0-9]+)",
                beginCaptures: {
                    "2": {
                        name: "meta.function-call.sqf",
                    },
                    "4": {
                        name: "support.function.sqf",
                    },
                },
                end: " |;|{|}|(|)",
                endCaptures: {
                    "1": {
                        name: "keyword.operator.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "var-call": {
                begin: "(\\s*)([a-zA-Z_0-9]+)([^a-zA-Z_0-9]|\\s+)",
                beginCaptures: {
                    "2": {
                        name: "variable.other.sqf",
                    },
                },
                end: " |;|{|}|(|)|[|]",
                endCaptures: {
                    "1": {
                        name: "keyword.operator.sqf",
                    },
                },
                name: "meta.declaration.object.sqf",
            },
            "var-call-priv": {
                match: "(\\s*)(_+[a-zA-Z_0-9]+)",
                name: "variable.other.private.sqf",
            },
            "indexer-parameter": {
                captures: {
                    "1": {
                        name: "variable.parameter.sqf",
                    },
                },
                match: "([a-zA-Z_$][\\w$]*)(?=\\:)",
                name: "meta.indexer.parameter.sqf",
            },
            literal: {
                name: "literal.sqf",
                patterns: [
                    {
                        include: "#numeric-literal",
                    },
                    {
                        include: "#boolean-literal",
                    },
                    {
                        include: "#null-literal",
                    },
                    {
                        include: "#array-literal",
                    },
                    {
                        include: "#reserved-literal",
                    },
                ],
            },
            "manipulative-operator": {
                match: "\\*|/|\\-|\\+|%|\\^|plus|\\%",
                name: "keyword.operator.manipulative.sqf",
            },
            "null-literal": {
                match: "\\b(null|nil|controlNull|displayNull|grpNull|locationNull|netObjNull|objNull|scriptNull|taskNull|teamMemberNull|configNull)\\b",
                name: "constant.language.null.sqf",
            },
            "numeric-literal": {
                match: "\\s*(?<=[^$])((0(x|X)[0-9a-fA-F]+)|([0-9]+(\\.[0-9]+)?))\\b",
                name: "constant.numeric.sqf",
            },
            "": {
                begin: "\\(",
                beginCaptures: {
                    "0": {
                        name: "meta.brace.paren.sqf",
                    },
                },
                end: "\\)",
                endCaptures: {
                    "0": {
                        name: "meta.brace.paren.sqf",
                    },
                },
                patterns: [
                    {
                        include: "#expression",
                    },
                ],
            },
            "property-accessor": {
                match: "\\s*(?i)(get|set|select)\\b",
                name: "storage.type.property.sqf",
            },
            "qstring-double": {
                begin: '"',
                end: '"',
                name: "string.double.sqf",
            },
            "qstring-single": {
                begin: "'",
                end: "'",
                name: "string.single.sqf",
            },
            string: {
                name: "string.sqf",
                patterns: [
                    {
                        include: "#qstring-single",
                    },
                    {
                        include: "#qstring-double",
                    },
                ],
            },
            "reserved-literal": {
                match: "\\s*(?i)(this|_this|_x|_forEachIndex|_exception|_thisScript|_thisFSM|thisList|thisTrigger|west|east|resistance|civilian|independent|blufor|opfor)\\b",
                name: "variable.language.reserved.sqf",
            },
        },
    };

    await fs.promises.writeFile(
        "client/languages/syntaxes/sqf.json",
        JSON.stringify(grammar)
    );
}

main().catch(console.error);
