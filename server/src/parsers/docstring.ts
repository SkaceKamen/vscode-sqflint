
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
	}

	export interface InfoParamater {
		name: string;
		type: string;
		description: string;
		optional: boolean;
		default: string;
	}

	// Used for cleanup, newline and tabs
	const tabRegex = /\n\t*/ig;

	// Matches param, 1 = index, 2 = optional, 3 = type, 4 = description
	const bisParam = /(?:_this\s*select)?\s*([0-9]+)\s*(\(optional\))?\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches singular param, 1 = type, 2 = description
	const bisParamSingular = /_this\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches returns description with type, 1 = type, 2 = description
	const returnWithDesc = /([^-:]*)[-:](.*)/;

	// Matches section beginning, 1 = section name, 2 = rest of the line
	const sectionRegex = /^\s*([a-z\(\)]+):\s*(.*)/i;

	// Sections in docstring
	type SECTION = 'returns' | 'parameters' | 'description' | 'author';
	const SECTION_RETURNS: SECTION = 'returns';
	const SECTION_PARAMETERS: SECTION = 'parameters';
	const SECTION_DESCRIPTION: SECTION = 'description';
	const SECTION_AUTHOR: SECTION = 'author';

	/**
	 * Prepares docstring to be easier to parse.
	 *
	 * @param comment docstring contents to be preprocessed
	 * @returns preprocessed dostring
	 */
	function preprocess (comment: string) {
		return comment.trim().replace(tabRegex, "\n");
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
			parameter: null
		};

		let section: SECTION = null;
		let match: RegExpMatchArray = null;

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
							section = SECTION_RETURNS;
							break;
						case 'description':
							section = SECTION_DESCRIPTION;
							break;
						case 'author':
							section = SECTION_AUTHOR;
							break;
						case 'parameter':
						case 'parameters':
						case 'parameter(s)':
							section = SECTION_PARAMETERS;
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
					case SECTION_AUTHOR:
						if (!result.author) {
							result.author = "";
						} else {
							result.author += "\n";
						}

						result.author += line;
						break;

					case SECTION_DESCRIPTION:
						if (!result.description.full) {
							result.description.full = "";
							result.description.short = line.trim().replace(/(\r?\n)/g, '$1$1');
						} else {
							result.description.full += "\n";
						}

						result.description.full += line;
						break;

					case SECTION_RETURNS:
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

					case SECTION_PARAMETERS:
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

						break;
				}
			})

		return result;
	}
}