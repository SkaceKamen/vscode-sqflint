import { normalizeTemplateParams } from "./templates"

const P_START = '{{'
const P_SEPARATOR = '|'
const P_ASSIGN = '='
const P_END = '}}'
const LINK_START = '[['
const LINK_END = ']]'

const NOWIKI_START = '<nowiki>'
const NOWIKI_END = '</nowiki>'
const PRE_START = '<pre>'
const PRE_END = '</pre>'
const COMMENT_START = '<!--'
const COMMENT_END = '-->'

const STATE_PARAMETER_NAME = 1
const STATE_PARAMETER_VALUE = 2

export const parseTemplate = (input: string) => {
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    const subParsers = getSubParsers()

    input = input.replace(/&gt;/g, '>')
    input = input.replace(/&lt;/g, '<')
    input = input.replace(/<br>/g, '\n')
    input = input.replace(/<code>/g, '')
    input = input.replace(/<\/code>/g, '')

    if (input.substr(0, 2) !== P_START) {
        throw new Error(`Template has to start with ${P_START}`)
    }

    input = input.substr(2)

    const nextSeparator = input.indexOf(P_SEPARATOR)
    if (nextSeparator < 0) {
        const end = input.indexOf(P_END)
        if (end < 0) {
            throw new Error(`Failed to find end of template block: ${P_END}`)
        }

        return { name: input.substr(0, end), parameters: {} }
    }

    const templateName = input.substr(0, nextSeparator).trim()
    const parameters = {}

    let paramName = ''

    let buffer = ''
    let index = nextSeparator + 1
    let state = STATE_PARAMETER_NAME
    let numberedIndex = 1
    const depth = 0

    while (index < input.length) {
        const eof = depth == 0 && input.substr(index, 2) === P_END

        // Sub parsers
        let continueBlocks = true
        while (continueBlocks) {
            continueBlocks = false
            for (const [start, callback] of subParsers) {
                if (input.substr(index, start.length) === start) {
                    const ref = { index }
                    const block = callback(input, ref)
                    buffer += block
                    index = ref.index
                    continueBlocks = true
                    break
                }
            }
        }

        const currentChar = input.charAt(index)
       
        switch (state) {
        case STATE_PARAMETER_NAME: {
            if (currentChar === P_ASSIGN) {
                paramName = buffer.trim()
                buffer = ''
                state = STATE_PARAMETER_VALUE
            } else if (currentChar === P_SEPARATOR || eof) {
                parameters[numberedIndex] = buffer.trim()
                numberedIndex++
                buffer = ''
                state = STATE_PARAMETER_NAME
            } else {
                buffer += currentChar
            }

            break
        }

        case STATE_PARAMETER_VALUE: {
            if (currentChar === P_SEPARATOR || eof) {
                parameters[paramName] = buffer.trim()
                buffer = ''
                state = STATE_PARAMETER_NAME
            } else {
                buffer += currentChar
            }

            break
        }
        }


        index++
    }

    return {
        name: templateName,
        parameters: normalizeTemplateParams(templateName, parameters)
    }
}


export const skipBlock = (start: string, end: string, contents: string, ref: { index: number }, skipTags: boolean) => {
    let buffer = ''
    let depth = 0

    while (ref.index < contents.length) {
        if (contents.substr(ref.index, end.length) === end) {
            depth--

            if (!skipTags) {
                buffer += contents.substr(ref.index, end.length)
            }

            ref.index += end.length
        } else if (contents.substr(ref.index, start.length) === start) {
            depth++

            if (!skipTags) {
                buffer += contents.substr(ref.index, start.length)
            }

            ref.index += start.length
        } else {
            buffer += contents.charAt(ref.index)
            ref.index++
        }

        if (depth === 0) {
            return buffer
        }
    }

    return buffer
}

export const parseLink = (contents: string, ref: { index: number }) => {
    const data = skipBlock(LINK_START, LINK_END, contents, ref, true)

    // Skip images
    if (data.startsWith('File:')) {
        return ''
    }

    const index = data.lastIndexOf(P_SEPARATOR)
    if (index < 0) {
        return data
    }

    return data.substr(index + 1)
}
export const parseComment = (contents: string, ref: { index: number }) => {
    skipBlock(COMMENT_START, COMMENT_END, contents, ref, false)
    return ''
}

export const parseNoWiki = (contents: string, ref: { index: number }) => {
    return skipBlock(NOWIKI_START, NOWIKI_END, contents, ref, true)
}

export const parsePre = (contents: string, ref: { index: number }) => {
    return skipBlock(PRE_START, PRE_END, contents, ref, false)
}

export const parseTemplateCommand = (contents: string, ref: { index: number }) => {
    const data = skipBlock(P_START, P_END, contents, ref, false)
    const template = parseTemplate(data)

    // TODO: This could use some improvements, there's like 100 different templates
    switch (template.name) {
    case 'Feature AFM':
    case 'Feature arma3contact':
    case 'Feature arma3oldman':
    case 'Feature dayz':
    case 'Feature Eden Editor':
    case 'Feature arma3':
    case 'Important':
    case 'Informative':
        return template.parameters[1]
    case 'since':
        return `since ${template.parameters[1]} ${template.parameters[2]}`
    default:
        if (Object.keys(template.parameters).length === 0) {
            return template.name
        }
        return ''
    }
}

const getSubParsers = () => ([
    [P_START, parseTemplateCommand] as const,
    [LINK_START, parseLink] as const,
    [NOWIKI_START, parseNoWiki] as const,
    [COMMENT_START, parseComment] as const,
    [PRE_START, parsePre] as const,
])
