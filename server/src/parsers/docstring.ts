
export namespace Docstring {
	export interface Info {
		name: string;
		author: string;
		description: {
			short: string;
			full: string;
		};
		returns: {
			type: string;
			description: string;
		};
		parameters: InfoParamater[];
		/// When not null, function have one _this param
		parameter: InfoParamater;
		examples: string[];
	}

	export interface InfoParamater {
		name: string;
		type: string;
		description: string;
		optional: boolean;
		default: string;
	}

	// Matches section beginning, 1 = section name, 2 = rest of the line
	const sectionRegex = /^\s*([a-z\(\)]+):\s*(.*)/i;

	// Matches param, 1 = index, 2 = optional, 3 = type, 4 = description
	const bisParam = /(?:_this\s*select)?\s*([0-9]+)\s*(\(optional\))?\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches singular param, 1 = type, 2 = description
	const bisParamSingular = /_this\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches CBA style param, 1 = name, 2 = description, 3 = type, 4 = default value
	const cbaParam = /(_\w+)\s*-\s*([^[]*)(?:\[([^,]*)(?:,\s*defaults\s+to\s+(.*))?\])?/i;

	// Matches returns description with type, 1 = type, 2 = description
	const returnWithDesc = /([^-:]*)[-:](.*)/;

	// Start of CBA style example code
	const exampleStart = /\(begin example\)/i;
	// End of CBA style example code
	const exampleEnd = /\(end\)/i;

	// Sections in docstring
	enum Section {
		Returns,
		Parameters,
		Description,
		Author,
		Examples
	}

	/**
	 * Prepares docstring to be easier to parse.
	 *
	 * @param comment docstring contents to be preprocessed
	 * @returns preprocessed dostring
	 */
	function preprocess (comment: string) {
		return comment.trim()
			.replace(/-{3,}/g, '')
			.replace(/\n\t*/g, "\n")
			.trim();
	}

	/**
	 * Parses docstring comment into structured output.
	 *
	 * @param comment docstring comment contents (without /*)
	 */
	export function parse (comment: string) {
		// Initialize result object
		let result: Info = {
			name: null,
			author: null,
			description: {
				short: null,
				full: null
			},
			returns: {
				type: null,
				description: null
			},
			parameters: [],
			parameter: null,
			examples: []
		};

		let section: Section = null;
		let match: RegExpMatchArray = null;

		let inExample = false;

		preprocess(comment)
			.split("\n")
			.forEach(line => {
				line = line.trim();

				// Switch section if needed
				match = sectionRegex.exec(line);
				if (match) {
					let ident = match[1].trim().toLowerCase();
					let unknown = false;
					let previous = section;

					switch (ident) {
						case 'returns':
						case 'return':
							section = Section.Returns;
							break;
						case 'description':
							section = Section.Description;
							break;
						case 'author':
							section = Section.Author;
							break;
						case 'parameter':
						case 'parameters':
						case 'parameter(s)':
							section = Section.Parameters;
							break;
						case 'examples':
							section = Section.Examples;
							break;
						default:
							unknown = true;
							break;
					}

					// Section was recognized
					if (!unknown) {
						// Some sections can have data at same line
						line = match[2].trim();

						// If there are no data, continue to next line
						if (!line) return;
					}
				}

				switch (section) {
					case Section.Author:
						if (!result.author) {
							result.author = "";
						} else {
							result.author += "\n";
						}

						result.author += line;
						break;

					case Section.Description:
						if (!result.description.full) {
							result.description.full = "";
							result.description.short = line.trim().replace(/(\r?\n)/g, '$1$1');
						} else {
							result.description.full += "\n";
						}

						result.description.full += line;
						break;

					case Section.Returns:
						// Try to separate type and description
						match = returnWithDesc.exec(line)
						if (match) {
							result.returns.type = match[1].trim();
							result.returns.description = match[2].trim();
						} else {
							// Use first word, which should be type
							result.returns.type = line.split(' ').shift();
						}
						break;

					case Section.Parameters:
						// Skip empty lines
						if (!line) return;

						// Prepare param struct
						let param: InfoParamater = {
							name: null,
							type: null,
							description: null,
							optional: null,
							default: null
						};

						// Try classic BIS param declaration
						match = bisParam.exec(line);
						if (match) {
							param.optional = !!match[2];
							param.type = match[3];
							param.description = match[4];

							result.parameters.push(param);
						}

						// Try BIS singular param declaration
						match = !match && bisParamSingular.exec(line);
						if (match) {
							param.type = match[1];
							param.description = match[2];

							result.parameter = param;
						}

						// Try CBA style param declaration
						match = !match && cbaParam.exec(line);
						if (match) {
							param.name = match[1];
							param.description = match[2];
							param.type = match[3];
							param.optional = !!match[4];
							param.default = match[4] || null;

							result.parameters.push(param);
						}

						break;

					case Section.Examples:
						if (exampleStart.test(line)) {
							result.examples.push("");
							inExample = true;
							return;
						}

						if (exampleEnd.test(line)) {
							inExample = false;
						}

						if (inExample) {
							if (result.examples[result.examples.length - 1]) {
								result.examples[result.examples.length - 1] += "\n";
							}
							result.examples[result.examples.length - 1] += line;
						}

						break;
				}
			})

		console.log(result);

		return result;
	}
}