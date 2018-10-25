import * as pegjs from 'pegjs';
import * as fs from 'fs';
import * as fs_path from 'path';
import { SQFLint } from '../sqflint'

var hppParser = <pegjs.Parser>require('./grammars/pegjs-hpp');
var hppPreprocessor = <pegjs.Parser>require('./grammars/pegjs-hpp-pre');

interface sourceMap {
	offset: { 0: number, 1: number, 2: number, 3: number };
	filename: string;
}

export namespace Hpp {
	let preprocessorMap: sourceMap[] = [];
	export let onFilename: (filename: string) => void;
	export let tryToLoad: (filename: string) => string = (filename) => { return null };
	export let log: (contents: string) => void = (contents) => { };

	export function parse(filename: string) {

		var processed: string = null;
		preprocessorMap = [];
		try {
			processed = preprocess(filename);
			return applyExtends(<ClassBody>hppParser.parse(processed));
		} catch (e) {
			if (e.location !== undefined) {
				var location = (<pegjs.PegjsError>e).location;

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

				throw createParseError(<pegjs.PegjsError>e, filename);
			} else {
				throw e;
			}
		}
	}

	function applyExtends(context: ClassBody): ClassBody {
		for (var i in context.classes) {
			context.classes[i].body.parent = context;
			applyExtendsClass(context.classes[i]);
		}

		return context;
	}

	function applyExtendsClass(context: Class) {
		if (context.extends) {
			let parent = context.body.parent;
			while (parent != null) {
				let ext = parent.classes[context.extends.toLowerCase()];
				if (ext) {
					for (var i in ext.body.variables) {
						context.body.variables[i] = ext.body.variables[i];
					}
					for (var i in ext.body.classes) {
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
			let loc = context.location;
			let info = pegjsLocationToSqflint(loc, true);

			context.fileLocation = {
				filename: info.filename,
				range: info.range
			};
		}

		applyExtends(context.body);
	}

	function createParseError(error: pegjs.PegjsError, filename: string) {
		let info = pegjsLocationToSqflint(error.location, true);
		return new ParseError(
			info.filename || filename, info.range, error.message
		);
	}

	export function pegjsLocationToSqflint(location: pegjs.LocationRange, useMap: boolean = false) {
		if (useMap) {
			for (let i in preprocessorMap) {
				let map = preprocessorMap[i];
				if (location.start.offset >= map.offset[0] &&
				    location.start.offset < map.offset[1]
				) {
					// console.log("Map match", map, location);

					return {
						filename: map.filename,
						range: <SQFLint.Range>{
							start: {
								line: location.start.line - map.offset[2],
								character: location.start.column - map.offset[3]
							},
							end: {
								line: location.end.line - map.offset[2],
								character: location.end.column - map.offset[3]
							}
						}
					};
				}
			}
		}

		return {
			filename: <string>null,
			range: <SQFLint.Range>{
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
	}

	function preprocess(filename: string, mapOffset: number = 0): string {
		if (onFilename) {
			onFilename(filename);
		}

		try {
			var contents = tryToLoad(filename) || fs.readFileSync(filename).toString();
			var result = <PreprocessorOutput>hppPreprocessor.parse(contents);
			var offset = 0;

			var basepath = fs_path.dirname(filename);

			for (var i in result) {
				var item = result[i];
				if (item.include) {
					var itempath = fs_path.join(basepath, item.include);

					if (fs.existsSync(itempath)) {
						var offsetStart = offset + item.location.start.offset;
						var offsetEnd = offset + item.location.end.offset;
						var offsetLine = contents.substr(0, offsetStart).split("\n").length;
						var offsetChar = contents.substring(contents.lastIndexOf("\n", offsetStart), offsetStart).length;
						var output = preprocess(itempath, offsetStart);

						preprocessorMap.push({
							offset: [ offsetStart, offsetStart + output.length, offsetLine, offsetChar ],
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
					filename, pegjsLocationToSqflint((<pegjs.PegjsError>e).location).range, e.message
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
			filename: string,
			range: SQFLint.Range
		};
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