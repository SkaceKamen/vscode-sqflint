declare module "nearley" {
	export interface Rule {
		name: string;
		symbols: any[];
		postprocess?: (d: any[], l?: number, r?: any) => void;
	}


	export class Parser {
		results: any[];
		
		constructor(rules: Rule[], start: string);

		feed(input: string);
		finish(): any[];
	}
}