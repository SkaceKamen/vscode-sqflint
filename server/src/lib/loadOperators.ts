import * as fs from "fs";
import path from "path";
import { WikiDocumentation } from "../server";
import { isNotNil } from "./isNotNil";

export enum OperatorType {
    Ternary,
    Binary,
    Unary,
}

export type Operator = {
    name: string;
    left: string;
    right: string;
    documentation: string;
    type: OperatorType;
    wiki: WikiDocumentation;
};

const TERNARY_RE = /b:([a-z,]*) ([a-z0-9_]*) ([a-z0-9,]*)/i;
const BINARY_RE = /u:([a-z0-9_]*) ([a-z0-9,]*)/i;
const UNARY_RE = /n:([a-z0-9_]*)/i;

const parseOperatorInfo = (line: string) => {
    const ternaryMatch = TERNARY_RE.exec(line);
    if (ternaryMatch) {
        return {
            name: ternaryMatch[2],
            left: ternaryMatch[1],
            right: ternaryMatch[3],
            type: OperatorType.Ternary,
            documentation: ternaryMatch[1] + " " + ternaryMatch[2],
            wiki: null,
        };
    }

    const binaryMatch = BINARY_RE.exec(line);
    if (binaryMatch) {
        return {
            name: binaryMatch[1],
            left: "",
            right: binaryMatch[2],
            type: OperatorType.Binary,
            documentation: binaryMatch[1],
            wiki: null,
        };
    }

    const unaryMatch = UNARY_RE.exec(line);
    if (unaryMatch) {
        return {
            name: unaryMatch[1],
            left: "",
            right: "",
            type: OperatorType.Unary,
            documentation: unaryMatch[1],
            wiki: null,
        };
    }

    return null;
};

export const loadOperators = async () => {
    const data = await fs.promises.readFile(
        path.join(__dirname, "../definitions/commands.txt"),
        "utf-8"
    );

    return data
        .split("\n")
        .map((l) => parseOperatorInfo(l))
        .filter(isNotNil);
};
