import { grammar } from './grammars/hpp';
import * as fs from 'fs'
import * as path from 'path'
import * as nearley from 'nearley'
import { SQFLint } from '../sqflint'

export namespace Hpp {
	export function parse(data: string, filename: string = null, context: Context = null) {
		// First, parse the file
		let parser = new nearley.Parser(grammar.ParserRules, grammar.ParserStart);
		let result;
		
		// Load raw data, remove CR
		let contents = data.toString()
			.replace(/\r/g, "")
			.replace(/\t/g, "    ");

		// Initialize empty context if needed
		context = context || new Context(null, '<root>');

		try {
			parser.feed(contents);
			result = parser.finish();
		} catch(error) {
			if (error.offset) {
				let range = offsetToRange(contents, error.offset);
				throw new ParseError(filename, range, error.toString());
			} else {
				throw error;
			}
		}

		// Now try postprocess the result
		if (result && result.length > 0) {
			loadBlock(result[0], context, filename, contents);
		}

		return context;
	}

	function parseFile(filename: string, context: Context) {
		let data = fs.readFileSync(filename);
		return parse(data.toString(), filename, context);
	}

	function offsetToPosition(contents: string, offset: number) {
		let part = contents.substr(0, offset);
		let line = part.split("\n").length;
		let character = offset - part.lastIndexOf("\n");

		return {
			line: line - 1,
			character: character - 1
		};
	}

	function offsetToRange(contents: string, start: number, end: number = null) {
		if (end == null) {
			end = start + 1
		}
		
		return <SQFLint.Range>{
			start: offsetToPosition(contents, start),
			end: offsetToPosition(contents, end)
		};
	}

	function loadBlock(block: Statement[], context: Context = null, filename: string, contents: string) {
		let root = path.dirname(filename);
		
		context = context || new Context();

		if (block) {
			block.forEach((item) => {
				if (item.include) {
					try {
						parseFile(path.join(root, item.include), context);
					} catch(error) {
						if (error instanceof ParseError) {
							throw error;
						} else {
							throw new ParseError(
								filename,
								offsetToRange(contents, item.location[0], item.location[1]),
								"Failed to load " + item.include + ": " + error.toString()
							);
						}
					}
				} else if (item.class) {
					let cls = new ContextClass();
					cls.name = item.class.name;
					cls.extends = item.class.extends;
					
					// console.log("Parsing class " + cls.name + ":" + cls.extends + " in " + context.name);
					cls.context = loadBlock(item.block, new Context(context, cls.name), filename, contents);
					// console.log("Done " + cls.name + ":" + cls.extends + " in " + context.name);

					if (cls.extends) {
						let ctx = context;
						let extended = false;
						while(ctx) {
							let c = ctx.classes[cls.extends.toLowerCase()];
							if (c) {
								cls.extend(c);
								extended = true;
								break;
							} else {
								/*console.log("Class not found in " + ctx.name + ". Going up.");
								for(let ident in ctx.classes) {
									console.log("Context class: " + ident);
								}*/
							}

							ctx = ctx.parent;
						}

						if (!extended) {
							throw new Error("Failed to find class " + cls.extends + " for extending " + cls.name + ".");
						}
					}

					context.classes[cls.name.toLowerCase()] = cls;
				} else if (item.variable) {
					context.variables[item.variable] = item.value;
				}
			});
		}

		return context;
	}

	export class Context {
		classes: ContextClasses = {};
		variables: ContextVariables = {};

		constructor(
			public parent: Context = null, 
			public name: string = null
		) {}

		extend(ctx: Context) {
			for (let i in ctx.classes) {
				if (typeof(this.classes[i]) === "undefined") {
					this.classes[i] = new ContextClass(ctx.classes[i]);
					this.classes[i].context.parent = this;
				}
			}
			
			for (let i in ctx.variables) {
				if (typeof(this.variables[i]) === "undefined") {
					this.variables[i] = ctx.variables[i];
				}
			}

			return this;
		}
	}

	export class ContextClasses {
		[ name: string ]: ContextClass;
	}

	export class ContextVariables {
		[ name: string ]: string | number | (string | number)[];
	}

	export class ContextClass {
		name: string;
		extends: string;
		context: Context;

		constructor(copy?: ContextClass) {
			if (copy) {
				this.name = copy.name;
				this.extends = copy.extends;
				this.context = new Context().extend(copy.context);
				this.context.name = this.name;
			}
		}

		extend(source: ContextClass) {
			// console.log(this.name, "extends", source.name);
			this.context.extend(source.context);
		}
	}

	export class ParseError {
		constructor(
			public filename: string,
			public range: SQFLint.Range,
			public message: string
		) {}
	}

	export interface ClassName {
		name: string;
		extends?: string;
	}

	export interface Statement {
		include?: string;
		location?: number[];
		class?: ClassName;
		variable?: string;
		value?: string | number | (string | number)[];

		block: Statement[];
	}
}