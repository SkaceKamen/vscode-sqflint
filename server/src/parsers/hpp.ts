import * as pegjs from 'pegjs';
import * as fs from 'fs';
import * as fs_path from 'path';
import { SQFLint } from '../sqflint'

var hppParser = <pegjs.Parser>require('./grammars/pegjs-hpp');
var hppPreprocessor = <pegjs.Parser>require('./grammars/pegjs-hpp-pre');

export namespace Hpp {
	export function parse(filename: string) {
		var processed: string = null;
		try {
			processed = preprocess(filename);
			fs.writeFileSync("output.ext", processed);
			return <ClassBody>hppParser.parse(processed);
		} catch (e) {
			if (e.location !== undefined) {
				var location = (<pegjs.PegjsError>e).location;

				if (processed) {
					var lines = processed.split("\n");
					for (var i = -2; i <= 2; i++) {
						var index = location.start.line - 1 + i;
						if (index >= 0 && index < lines.length) {
							console.log((index + 1) + "\t" + lines[index]);
						}
					}
				}

				throw new ParseError(
					filename, pegjsLocationToSqflint(location), e.message
				)
			} else {
				throw e;
			}
		}
	}

	export function pegjsLocationToSqflint(location: pegjs.LocationRange) {
		return <SQFLint.Range>{
			start: {
				line: location.start.line,
				character: location.start.column
			},
			end: {
				line: location.end.line,
				character: location.end.column
			}
		}
	}

	function preprocess(filename: string): string {
		try {
			var contents = fs.readFileSync(filename).toString();
			var result = <PreprocessorOutput>hppPreprocessor.parse(contents);
			var offset = 0;

			var basepath = fs_path.dirname(filename);

			for (var i in result) {
				var item = result[i];
				if (item.include) {
					var itempath = fs_path.join(basepath, item.include);

					if (fs.existsSync(itempath)) {
						var output = preprocess(itempath);
						contents = contents.substr(0, offset + item.location.start.offset) +
							output +
							contents.substr(offset + item.location.end.offset);
						
						offset += output.length;
					} else {
						// @TODO: Maybe continue?
						throw new ParseError(
							filename, pegjsLocationToSqflint(item.location), "Failed to find '" + itempath + "'"
						);
					}
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
					filename, pegjsLocationToSqflint((<pegjs.PegjsError>e).location), e.message
				)
			} else {
				throw e;
			}
		}
	}

	export type PreprocessorOutput = IncludeOrDefine[];

	export interface IncludeOrDefine {
		include: string;
		define: string;
		location: pegjs.LocationRange
	}


	export interface ClassBody {
		classes: { [name: string]: Class };
		variables: { [name: string]: string };
	}

	export interface Class {
		name: string;
		extends?: string;
		body?: ClassBody;
		location: pegjs.LocationRange;
		filename: string;
	}

	export class ParseError {
		constructor(
			public filename: string,
			public range: SQFLint.Range,
			public message: string
		) {}
	}
}