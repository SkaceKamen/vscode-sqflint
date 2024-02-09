import Parser from 'wikiparser-node';
import { bikiConfig } from './bikiConfig';

export type CommandOrFunctionInfo = {
	type: 'function' | 'command';
	description?: string;
	compatibility: {
		game: string;
		version: string;
	}[];
	syntaxes: SyntaxInfo[];
}

export type SyntaxInfo = {
	code: string;
	since?: string;
	args: SyntaxInfoArg[];
	returns?: {
		type?: string;
		desc?: string;
	};
}

export type SyntaxInfoArg = {
	name: string;
	type?: string;
	desc?: string;
	optional?: boolean;
	since?: string;
}

const SYNTAX_PATTERN = /^s([1-9][0-9]*)$/;
const PARAM_PATTERN = /^p([1-9][0-9]*)$/;
const RETURNS_PATTERN = /^r([1-9][0-9]*)$/;
const PARAM_DESC_PATTERN1 = /^(\w+): (\w+) - (.+)$/;
const PARAM_DESC_PATTERN2 = /^(\w+): (\w+)$/;
const RETURNS_DESC_PATTERN1 = /^(\w+) - (.+)$/;
const RETURNS_DESC_PATTERN2 = /^(\w+)$/;
const PARAM_OPTIONAL_PATTERN = /^\s*\(\s*optional/i;
const GAME_PARAM_PATTERN = /^game(\d+)$/;
const VERSION_PARAM_PATTERN = /^version(\d+)$/;

const innerText = (node: Parser.Token | Parser.AstText | undefined): string => {
    if (node?.type === undefined) {
        return node?.data ?? '';
    }

    if (node?.type === 'text') {
        return node?.data ?? '';
    }

    if (node?.type === 'link') {
        const target = node.childNodes.find((node) => node.type === 'link-target');
        const text = node.childNodes.find((node) => node.type === 'link-text');

        if (text) {
            return innerText(text);
        }

        if (target) {
            return innerText(target);
        }

        return node.childNodes.map((node) => innerText(node)).join('');
    }

    if (node?.type === 'quote') {
        return '';
    }

    if (node?.type === 'template') {
        if (node?.name === 'Template:Hl') {
            return '`' + innerText(node.childNodes?.[1]) + '`';
        }

        return '';
    }

    return node?.childNodes?.map((node) => innerText(node)).join('') ?? '';
};

export const parseBikiCommandTemplate = (code: string): CommandOrFunctionInfo => {
    const data = Parser.parse(code, undefined, undefined, bikiConfig);

    let description = undefined as string | undefined;
    let type = 'command';

    const compatibility = {} as Record<
		string,
		{
			game: string;
			version: string;
		}
	>;

    const syntaxes = {} as Record<
		number,
		{
			code: string;
			since?: string;
			args: Record<number, SyntaxInfoArg>;
			returns?: {
				type?: string;
				desc?: string;
			};
		}
	>;

    const getSyntax = (index: number) => {
        if (!syntaxes[index]) {
            syntaxes[index] = {
                code: '',
                args: {},
            };
        }

        return syntaxes[index];
    };

    const parseTemplateParameter = (node: Parser.Token) => {
        if (node.name === 'type') {
            type = innerText(node.childNodes?.[1]).trim();
            return;
        }

        if (node.name === 'descr') {
            description = innerText(node.childNodes?.[1]).trim();
            return;
        }

        const syntaxMatch = SYNTAX_PATTERN.exec(node.name ?? '');
        if (syntaxMatch) {
            const syntax = getSyntax(+syntaxMatch[1]);
            syntax.code = innerText(node.childNodes?.[1]).trim() ?? '';
            return;
        }

        const paramMatch = PARAM_PATTERN.exec(node.name ?? '');
        if (paramMatch) {
            const index = parseInt(paramMatch[1]);
            const syntaxIndex = 1 + Math.floor((index - 1) / 20);
            const paramIndex = (index - 1) % 20;
            const text = innerText(node.childNodes?.[1]).trim() ?? '';

            let name = text;
            let type = undefined as string | undefined;
            let description = undefined as string | undefined;
            let optional = undefined as boolean | undefined;

            const firstPatternMatch = PARAM_DESC_PATTERN1.exec(text);
            const secondPatternMatch =
                    !firstPatternMatch && PARAM_DESC_PATTERN2.exec(text);
            if (firstPatternMatch) {
                name = firstPatternMatch[1];
                type = firstPatternMatch[2];
                description = firstPatternMatch[3];
            } else if (secondPatternMatch) {
                name = secondPatternMatch[1];
                type = secondPatternMatch[2];
            }

            if (description) {
                const optionalMatch = PARAM_OPTIONAL_PATTERN.exec(description);
                if (optionalMatch) {
                    optional = true;
                }
            }

            const syntax = getSyntax(syntaxIndex);
            syntax.args[paramIndex] = {
                name,
                type,
                desc: description?.trim(),
                optional,
            };

            return;
        }

        const returnsMatch = RETURNS_PATTERN.exec(node.name ?? '');
        if (returnsMatch) {
            const syntax = getSyntax(+returnsMatch[1]);
            const text = innerText(node.childNodes?.[1]).trim() ?? '';

            let type = undefined as string | undefined;
            let description = undefined as string | undefined;

            const firstPatternMatch = RETURNS_DESC_PATTERN1.exec(text);
            const secondPatternMatch =
                !firstPatternMatch && RETURNS_DESC_PATTERN2.exec(text);

            if (firstPatternMatch) {
                type = firstPatternMatch[1];
                description = firstPatternMatch[2];
            } else if (secondPatternMatch) {
                type = secondPatternMatch[1];
            }

            syntax.returns = {
                type,
                desc: description,
            };

            return;
        }

        const gameMatch = GAME_PARAM_PATTERN.exec(node.name ?? '');
        if (gameMatch) {
            const index = parseInt(gameMatch[1]);

            if (!compatibility[index]) {
                compatibility[index] = {
                    game: '',
                    version: '',
                };
            }

            compatibility[index].game = innerText(node.childNodes?.[1]).trim();

            return;
        }

        const versionMatch = VERSION_PARAM_PATTERN.exec(node.name ?? '');
        if (versionMatch) {
            const index = parseInt(versionMatch[1]);

            if (!compatibility[index]) {
                compatibility[index] = {
                    game: '',
                    version: '',
                };
            }

            compatibility[index].version = innerText(
                node.childNodes?.[1]
            ).trim();

            return;
        }
    };

    const parseRVTemplate = (node: Parser.Token) => {
        for (const child of node.childNodes ?? []) {
            if (child.type === 'parameter') {
                parseTemplateParameter(child as Parser.Token);
            }
        }
    };

    const parseTabView = (node: Parser.Token) => {
        let targetIndex = 0;
        const tabs = {} as Record<number, Parser.AstNodes>;

        for (const child of node.childNodes ?? []) {
            if (child.type === 'parameter') {
                if (child.name === 'selected') {
                    targetIndex = parseInt(innerText(child.childNodes?.[1]).trim()) - 1;
                    continue;
                }

                const tabContentMatch = /^content(\d+)$/.exec(child.name ?? '');
                if (tabContentMatch) {
                    const index = parseInt(tabContentMatch[1]);
                    tabs[index] = child.childNodes[1];
                    continue;
                }
            }
        }

        const tab = tabs[targetIndex] ?? Object.values(tabs)[0];

        if (tab) {
            processNode(tab as Parser.Token);
        }
    };

    const processNode = (node: Parser.Token) => {
        for (const child of node.childNodes ?? []) {
            if (child.type === 'template' && child.name === 'Template:RV') {
                parseRVTemplate(child as Parser.Token);
            } else if (child.type === 'template' && child.name === 'Template:TabView') {
                parseTabView(child as Parser.Token);
            }
        }
    };

    processNode(data);

    return {
        type: type as 'function' | 'command',
        description,
        compatibility: Object.values(compatibility),
        syntaxes: Object.values(syntaxes).map((s) => ({
            ...s,
            args: Object.values(s.args),
        })),
    };
};
