import {
    SourceMapItem,
    getLocationFromOffset,
    getMappedOffsetAt,
} from "@bi-tools/preprocessor";
import fs from "fs";
import { SqfParserTypes } from "../sqfParserTypes";

export class OffsetsMapper {
    private fileContents: Record<string, string> = {};
    private fileContentsLoaders: Record<string, Promise<string>> = {};

    constructor(
        private readonly baseFilename: string,
        private readonly sourceMap: SourceMapItem[]
    ) {}

    async getContents(filename: string) {
        if (!this.fileContents[filename]) {
            try {
                const loader =
                    this.fileContentsLoaders[filename] ??
                    (this.fileContentsLoaders[filename] = fs.promises.readFile(
                        filename,
                        "utf-8"
                    ));

                this.fileContents[filename] = await loader;

                delete this.fileContentsLoaders[filename];
            } catch (err) {
                console.error("Failed to load source map file", filename, err);

                this.fileContents[filename] = "";
            }
        }
        return this.fileContents[filename];
    }

    async getProperOffset(offset: number, mapToFile?: string) {
        // TODO: This function is slow if you have tons of sourceMaps
        const mapped = !mapToFile
            ? getMappedOffsetAt(this.sourceMap, offset, this.baseFilename)
            : { offset, file: mapToFile };

        const location = getLocationFromOffset(
            mapped.offset,
            await this.getContents(mapped.file)
        );

        return location;
    }

    // TODO: This is the slowest part of this function, hard to optimize now
    async offsetsToRange(start: number, end: number, mapToFile?: string) {
        const startLocation = await this.getProperOffset(start, mapToFile);
        const endLocation = await this.getProperOffset(end, mapToFile);

        return new SqfParserTypes.Range(
            new SqfParserTypes.Position(
                startLocation.line - 1,
                startLocation.column - 1
            ),
            new SqfParserTypes.Position(
                endLocation.line - 1,
                endLocation.column - 1
            )
        );
    }
}
