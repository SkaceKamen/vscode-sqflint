
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

	// Start of description section
	const descRegex = /description:(?:\s|\n|\r)*(.*)/i;

	// Start of parameters section, 1 = contents after parameters tag
	const paramsRegex = /parameter(?:\(s\)|s)?:([^]*)/im;

	// Start of returns section
	const returnRegex = /returns:(?:\s|\n|\r)*(.*)/i;

	// Matches param, 1 = index, 2 = optional, 3 = type, 4 = description
	const bisParam = /(?:_this\s*select)?\s*([0-9]+)\s*(\(optional\))?\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches singular param, 1 = type, 2 = description
	const bisParamSingular = /_this\s*:\s*(\w*)\s*-\s*(.*)/i;

	// Matches returns description with type, 1 = type, 2 = description
	const returnWithDesc = /([^-:]*)[-:](.*)/;

	/**
	 * Prepares docstring to be easier to parse.
	 *
	 * @param comment docstring contents to be preprocessed
	 * @returns preprocessed dostring
	 */
	function preprocess (comment: string) {
		return comment.trim().replace(tabRegex, "\n");
	}

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

		comment = preprocess(comment);

		// Try to load description
		let match = descRegex.exec(comment);
		if (match) {
			result.description.short = match[1].trim().replace(/(\r?\n)/g, '$1$1');
		}

		// Try to load return type
		match = returnRegex.exec(comment);
		if (match) {
			let value = match[1].trim();

			match = returnWithDesc.exec(value)
			if (match) {
				result.returns.type = match[1].trim();
				result.returns.description = match[2].trim();
			} else {
				result.returns.type = value.split(' ').shift();
			}
		}

		// Try to load params
		match = paramsRegex.exec(comment);
		if (match) {
			let lines = match[1].trim().split('\n');

			lines.forEach(line => {
				if (line.trim().length === 0) return;

				console.log('Checking line', line);

				let param: InfoParamater = {
					name: null,
					type: null,
					description: null,
					optional: null,
					default: null
				};

				let match = bisParam.exec(line);
				if (match) {
					param.optional = !!match[2];
					param.type = match[3];
					param.description = match[4];

					result.parameters.push(param);
				}

				match = !match && bisParamSingular.exec(line);
				if (match) {
					param.type = match[1];
					param.description = match[2];

					result.parameter = param;
				}
			})
		}

		console.log(result)

		return result;
	}
}